import path from "node:path";

import { expect, test } from "@playwright/test";

import { builtRoutes, DIST, distFiles } from "../helpers/dist";

/**
 * ADR-0024「`_astro/` を長くキャッシュする」— `_astro/` は1年キャッシュさせ、ページは確かめ直させる。
 *
 * public/_headers の Cache-Control が、Cloudflare の既定（max-age=0, must-revalidate）を置き換えることを、配られたレスポンスで見る。
 * wrangler dev は本番と同じ workerd で public/_headers を適用する（playwright.config.ts）。
 */
const IMMUTABLE = "public, max-age=31536000, immutable";

const astroFiles = (): string[] =>
  distFiles()
    .map((file) => path.relative(DIST, file).split(path.sep).join("/"))
    .filter((rel) => rel.startsWith("_astro/"));

test("_astro/ のファイルは、名前にフィンガープリントが入っている", () => {
  // 中身が変わっても名前が変わらないファイルを置くと、1年のあいだ古いものが使われる。
  expect(astroFiles().filter((rel) => !/\.[\w-]{8,}\.\w+$/.test(rel))).toEqual([]);
});

test("_astro/ のファイルは、1年キャッシュさせる", async ({ request }) => {
  // 規則はパスで当たるので、拡張子ごとに1つずつ見る。
  const samples = [...new Map(astroFiles().map((rel) => [path.extname(rel), rel])).values()];
  expect(samples.length, "_astro/ にファイルが無い").toBeGreaterThan(0);

  for (const rel of samples) {
    const response = await request.get(`/${rel}`);
    expect(response.headers()["cache-control"], rel).toBe(IMMUTABLE);
  }
});

test("ページは、開くたびに確かめ直させる", async ({ request }) => {
  // ページを長くキャッシュさせると、デプロイしても、前のページと前の _astro/ の URL が使われ続ける。
  for (const route of builtRoutes()) {
    const response = await request.get(route);
    expect(response.headers()["cache-control"], route).toMatch(/\bmax-age=0\b/);
  }
});
