import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * 検索避けを外したこと（Issue rurino-nemo-fansite#31 の一般公開）が、静的ファイルで戻っていないことを見る。
 *
 * 公開前は docs/CONCEPT.md §6「プレビュー版は検索避け必須」により、ここで「付いていること」を見ていた。
 * 解除のとき、このファイルは消さずに反転させた。消すと「いつ外したか」がテストの履歴から消える
 * （docs/adr/0003-testing-and-ci.md「反転させる。消さない」）。
 *
 * meta タグとレスポンスのヘッダーは規約テストで見る（tests/conformance/routes.spec.ts）。
 * ここは静的ファイル2枚の中身だけを見る。
 */
const read = (relPath: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relPath}`, import.meta.url)), "utf8");

/** `_headers` を、URL パターンの行と、その下の字下げしたヘッダー行のまとまりに分ける（Cloudflare の _headers 形式）。 */
function headerRules(text: string): { pattern: string; headers: string }[] {
  const rules: { pattern: string; headers: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) {
      const last = rules.at(-1);
      if (last) last.headers += `${line.trim()}\n`;
    } else {
      rules.push({ pattern: line.trim(), headers: "" });
    }
  }
  return rules;
}

/**
 * プレビューURL（`<エイリアスまたはバージョン>-rrnnm-fans.<subdomain>.workers.dev`）の全部に当たるパターン。
 * 先頭のラベルとサブドメインの両方がプレースホルダーでないと、`main-…`・`pr-…` のどれかから外れる。
 */
const PREVIEW_HOSTS = /^https:\/\/:\w+\.:\w+\.workers\.dev\/\*$/;

describe("検索避けを外した（Issue rurino-nemo-fansite#31）", () => {
  it("robots.txt が全パスを Disallow していない", () => {
    const robots = read("public/robots.txt");
    expect(robots).toMatch(/^User-agent:\s*\*$/m);
    expect(robots).not.toMatch(/^Disallow:\s*\/\*?\s*(#.*)?$/im);
  });

  it("_headers が、プレビューURL以外のパターンに X-Robots-Tag の noindex・nofollow を付けていない", () => {
    const rules = headerRules(read("public/_headers")).filter(
      (r) => !PREVIEW_HOSTS.test(r.pattern),
    );
    for (const rule of rules) {
      expect(rule.headers, rule.pattern).not.toMatch(/X-Robots-Tag:.*\b(noindex|nofollow|none)\b/i);
    }
  });

  it("_headers が、プレビューURLの全部に当たるパターンに noindex を付けている", () => {
    const rule = headerRules(read("public/_headers")).find((r) => PREVIEW_HOSTS.test(r.pattern));
    expect(rule, "プレビューURLの全部に当たるパターンが無い").toBeDefined();
    expect(rule?.headers).toMatch(/X-Robots-Tag:\s*noindex/i);
  });
});
