import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

/**
 * tests/fixtures/unreleased/ の小さなサイトを、SHOW_UNRELEASED のオンとオフで実際にビルドして比べる。
 * 出し分けは Astro と Vite のルートと import の解決に頼っているので、上げたときに効かなくなっても気付けるようにする。
 */
const PAGE = [/unreleased-page-markup/, /#070809|rgb\(7, ?8, ?9\)/, /unreleased-page-script/];
const PARTS = [
  /unreleased-section-markup/,
  /#010203|rgb\(1, ?2, ?3\)/,
  /unreleased-section-script/,
  /unreleased-react-markup/,
  /#040506|rgb\(4, ?5, ?6\)/,
];
/** 区画の CSS が url() で指すアセット。Vite が data URI にせずファイルとして出すよう、4 KiB より大きくしてある。 */
const ASSET = /^_astro\/marker\.[\w-]+\.svg$/;

async function buildFixture(show: "0" | "1") {
  // 出力先が作業ディレクトリの外だと、Astro は途中の出力を作業ディレクトリの .astro/ に置き、並行するビルドとぶつかるため。
  const base = path.resolve("test-results");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, "unreleased-"));
  await promisify(execFile)(
    process.execPath,
    [path.resolve("tests/fixtures/unreleased/build.mjs"), dir],
    {
      env: { ...process.env, SHOW_UNRELEASED: show, NODE_ENV: "production" },
      timeout: 90_000,
    },
  );
  const dist = path.join(dir, "dist");
  const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(dist, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    )
    .sort();
  const read = (file: string) => readFile(path.join(dist, file), "utf8");
  const text = (
    await Promise.all(files.filter((file) => /\.(html|js|css|xml)$/.test(file)).map(read))
  ).join("\n");
  const locs = [...(await read("sitemap-0.xml")).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  return { dir, files, read, text, locs };
}

test.describe("ADR-0018 の決定 — src/unreleased/ のものは、オンのときだけ出す", () => {
  test.setTimeout(120_000);

  test("オフ: 未公開のページも、外から import した区画も、成果物と sitemap に出ない", async () => {
    const built = await buildFixture("0");
    try {
      expect(built.files.filter((file) => file.endsWith(".html"))).toEqual(["index.html"]);
      expect(built.locs).toEqual(["https://example.com/"]);
      expect(built.text).toContain("released-markup");
      for (const marker of [...PAGE, ...PARTS]) expect(built.text).not.toMatch(marker);
      expect(built.files.filter((file) => ASSET.test(file))).toEqual([]);
    } finally {
      await rm(built.dir, { recursive: true, force: true });
    }
  });

  test("オン: 未公開のページは script ごとルートになって sitemap に載り、外から import した区画も出る", async () => {
    const built = await buildFixture("1");
    try {
      expect(built.files.filter((file) => file.endsWith(".html"))).toEqual([
        "index.html",
        "secret/index.html",
      ]);
      expect(built.locs).toEqual(["https://example.com/", "https://example.com/secret/"]);
      // 注入したページの script を Astro が処理したかを見る。処理した script は type="module" で出る。
      expect(await built.read("secret/index.html")).toMatch(/<script type="module"/);
      for (const marker of [...PAGE, ...PARTS]) expect(built.text).toMatch(marker);
      expect(built.files.filter((file) => ASSET.test(file))).toHaveLength(1);
    } finally {
      await rm(built.dir, { recursive: true, force: true });
    }
  });
});
