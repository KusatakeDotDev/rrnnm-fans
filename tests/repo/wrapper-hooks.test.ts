import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

import { stringLiterals } from "../helpers/string-literals";

/**
 * docs/adr/0011-react-components-for-design-sync.md「スクリプトの扱い」
 *
 * ラッパー（`src/components` と、未公開の区画の `src/unreleased/_parts` の `.astro`）のスクリプトは、コンポーネント（`.tsx`）が付けた `data-*` のマーカーで要素を探す。
 * マーカーの名前はコンポーネントとスクリプトの2か所に文字で書くので、片方だけ変えても型検査もビルドも通り、スクリプトが黙って止まる。
 *
 * tests/artifact/build-output.spec.ts も同じことをビルドの出力で見ているが、あちらはページに置いているラッパーにしか
 * 掛からない。こちらはソースを読むので、ページに置いていないラッパーにも掛かる。
 *
 * **このテストはマーカーの名前を持たない。** ラッパーのスクリプトの文字列リテラルから属性セレクタ（`[data-…]`）を拾い、
 * その名前がコンポーネントの側に書かれているかを見る。コンポーネントの側は、ラッパーと同じ名前の `.tsx` に限らない
 * （PlaylistGrid.astro が探す `data-youtube-thumbnail` は YouTubeThumbnail.tsx が付ける）。
 * JSX の属性のほか、コンポーネントが出すスクリプトが `setAttribute` で付ける名前（NemophilaField.tsx の `data-field-snapshot`）も
 * 文字列として数える。コメントにだけ名前が残っていても通らない。
 *
 * ラッパーのスクリプトが、自分で付け外しするマーカー（コンポーネントの側に名前が無いもの）を探すようになると、ここで落ちる。
 * そのときは、そのマーカーをここで名指しで外す。
 */
const dirs = ["src/components/", "src/unreleased/_parts/"];
const absolute = (file: string) => fileURLToPath(new URL(`../../${file}`, import.meta.url));
const read = (file: string) => readFileSync(absolute(file), "utf8");
const files = dirs.flatMap((dir) =>
  readdirSync(absolute(dir))
    .sort()
    .map((name) => `${dir}${name}`),
);

/** `.astro` の、フロントマター（`---` の間）より後ろにある `<script>` の中身。フロントマターの注記の `<script>` を拾わない。 */
const scriptsOf = (astro: string): string[] => {
  const template = astro.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  return [...template.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(([, body]) => body);
};

/** `.tsx` の中で、マーカーの名前を書ける所（JSX の属性名と、文字列・テンプレートリテラルの中身）。コメントと JSX の文は数えない。 */
const writtenNames = (tsx: string): string[] => {
  const file = ts.createSourceFile(
    "component.tsx",
    tsx,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node)) found.push(node.name.getText(file));
    else if (ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
};

const hooks = files
  .filter((name) => name.endsWith(".astro"))
  .flatMap((astro) =>
    scriptsOf(read(astro))
      .flatMap(stringLiterals)
      .flatMap((text) =>
        [...text.matchAll(/\[(data-[\w-]+)(?=[\]=~|^$*])/g)].map(([, hook]) => `${astro}: ${hook}`),
      ),
  );
const componentNames = files
  .filter((name) => name.endsWith(".tsx"))
  .flatMap((tsx) => writtenNames(read(tsx)));

describe("src/components・src/unreleased/_parts — ラッパーのスクリプトが探すマーカー", () => {
  it("マーカーが1つ以上見つかる", () => {
    // 読み方を間違えて空配列になると、下の検査が素通りする。
    expect(hooks.length).toBeGreaterThan(0);
  });

  it("ラッパーのスクリプトが探すマーカーは、どれかのコンポーネント（.tsx）に書かれている", () => {
    const missing = [...new Set(hooks)].filter((entry) => {
      const hook = entry.slice(entry.indexOf(": ") + 2);
      const written = new RegExp(`(?<![\\w-])${hook}(?![\\w-])`);
      return !componentNames.some((name) => written.test(name));
    });
    expect(missing).toEqual([]);
  });
});
