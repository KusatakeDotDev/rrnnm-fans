import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";
import { versions } from "vite-plus/versions";

/**
 * Vitest と Vite のバージョンを、vite-plus の中のものにそろえているかを見る（ADR-0031「Vitest と Vite のバージョンは、
 * vite-plus の中のものにそろえる」）。
 *
 * Vitest は peer の Vite ごとに別のものとして入る。2つ入ると、テストのファイルが vite-plus/test で登録する先と、
 * Stryker が回す Vitest が別になる。Dependabot は vite-plus と vitest・@vitest/* を別々に上げうるので、ずれた PR はここで落ちる。
 * Vite を vite-plus-core に差し替えたので、peer の Vite の範囲は pnpm に見させていない（pnpm-workspace.yaml の
 * peerDependencyRules）。中の Vite がその範囲に入るかは、ここで見る。
 */

// ほかの tests/repo のテスト（playwright-image.test.ts など）と同じ形。
const read = (relPath: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relPath}`, import.meta.url)), "utf8");

const require = createRequire(import.meta.url);
type Manifest = {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const vitePlus = require("vite-plus/package.json") as Manifest;
const astro = require("astro/package.json") as Manifest;

const workspaceLines = read("pnpm-workspace.yaml").split(/\r?\n/);
const lockLines = read("pnpm-lock.yaml").split(/\r?\n/);

/** トップの `<name>:` のブロックの、2桁下げた `<キー>: <値>` を読む。キーと値の引用符は外す。 */
function block(lines: string[], name: string): Map<string, string> {
  const start = lines.indexOf(`${name}:`);
  if (start < 0) return new Map();
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\S/.test(line) && !line.startsWith("#"));
  return new Map(
    (end < 0 ? rest : rest.slice(0, end)).flatMap((line) => {
      const m = /^ {2}(['"]?)([^'"\s][^'"]*?)\1: *(['"]?)(.+?)\3$/.exec(line);
      return m ? [[m[2], m[4]] as const] : [];
    }),
  );
}
const catalog = block(workspaceLines, "catalog");
const overrides = block(workspaceLines, "overrides");

/**
 * ロックファイルの packages: で、peerDependencies に vite を持つものと、その範囲。
 * ロックファイルは YAML の文書が2つ（pnpm と Node のものと、依存のもの）あり、どちらにも packages: がある。
 */
function vitePeerRanges(): [pkg: string, range: string][] {
  const ranges: [string, string][] = [];
  let inPackages = false;
  let pkg = "";
  let inPeers = false;
  for (const line of lockLines) {
    if (/^\S/.test(line)) inPackages = line === "packages:";
    else if (/^ {2}\S/.test(line)) pkg = line.trim().replace(/:$/, "");
    else if (/^ {4}\S/.test(line)) inPeers = line.trim() === "peerDependencies:";
    const m = inPackages && inPeers && /^ {6}vite: *(['"]?)(.+?)\1$/.exec(line);
    if (m) ranges.push([pkg, m[2]]);
  }
  return ranges;
}

const parse = (version: string) => version.split(".").map(Number);
const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * `^1.2.3`・`>=1.2.3`・`1.2.3` と、それを `||` でつないだ範囲だけを読む。ほかの書き方は、読めないとして落とし、人に見てもらう。
 * 入れているもののメジャーは 0 ではないので、`^0.x` の読み方は持たない。
 */
function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  return range.split("||").some((part) => {
    const m = /^(\^|>=)?(\d+\.\d+\.\d+)$/.exec(part.trim());
    if (!m) throw new Error(`範囲の書き方を読めない: ${range}`);
    const r = parse(m[2]);
    if (m[1] === ">=") return compare(v, r) >= 0;
    if (m[1] === "^" && r[0] === 0) throw new Error(`範囲の書き方を読めない: ${range}`);
    if (m[1] === "^") return v[0] === r[0] && compare(v, r) >= 0;
    return compare(v, r) === 0;
  });
}

describe("ADR-0031 — Vitest と Vite のバージョンは、vite-plus の中のものにそろえる", () => {
  it.each([
    ["vitest", vitePlus.dependencies?.vitest],
    ["@vitest/browser", vitePlus.dependencies?.["@vitest/browser"]],
    ["@vitest/browser-playwright", vitePlus.peerDependencies?.["@vitest/browser-playwright"]],
    ["vite", vitePlus.dependencies?.vite],
  ])("catalog の %s は、vite-plus が求めるものと同じ", (name, wanted) => {
    expect(wanted, `vite-plus の package.json から ${name} を読めない`).toBeDefined();
    expect(
      catalog.get(name),
      `pnpm-workspace.yaml の catalog の ${name} を、vite-plus の ${wanted} にそろえる`,
    ).toBe(wanted);
  });

  it("vite-plus が中に持つ Vitest は、catalog の vitest と同じバージョン", () => {
    expect(versions.vitest).toBe(catalog.get("vitest"));
  });

  it.each(["vite@*", "vitest@*"])("overrides で、どの依存の %s も catalog のものにする", (key) => {
    expect(
      overrides.get(key),
      `pnpm-workspace.yaml の overrides に '${key}': 'catalog:' を書く`,
    ).toBe("catalog:");
  });

  it("Astro が求める Vite の範囲に、vite-plus の中の Vite が入る", () => {
    const range = astro.dependencies?.vite;
    expect(range, "astro の package.json から vite を読めない").toBeDefined();
    expect(
      satisfies(versions.vite, range ?? ""),
      `Astro は vite ${range} を求めるが、vite-plus の中は ${versions.vite}`,
    ).toBe(true);
  });

  it("Vite を peer に持つ依存が求める範囲に、vite-plus の中の Vite が入る", () => {
    const ranges = vitePeerRanges();
    expect(ranges, "ロックファイルから、Vite を peer に持つ依存を読めない").not.toEqual([]);
    expect(ranges.filter(([, range]) => !satisfies(versions.vite, range))).toEqual([]);
  });
});

describe("範囲の読み方", () => {
  it.each([
    ["8.3.5", "^8.0.0", true],
    ["8.3.5", "^8.3.5", true],
    ["8.3.5", "^8.4.0", false],
    ["8.3.5", "^9.0.0", false],
    ["8.3.5", "^6.4.0 || ^7.0.0 || ^8.0.0", true],
    ["8.3.5", ">=8.3.0", true],
    ["8.3.5", ">=8.4.0", false],
    ["8.3.5", "8.3.5", true],
    ["8.3.5", "8.3.4", false],
  ])("%s は %s に入るか: %s", (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });

  it.each(["8.x", "^0.3.0", "~8.3.0"])(
    "読めない書き方の範囲（%s）は、入らないとせずに落とす",
    (range) => {
      expect(() => satisfies("8.3.5", range)).toThrow("範囲の書き方を読めない");
    },
  );
});
