import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { componentPathByName } from '../helpers/components';

/**
 * コンポーネントに story が全部あるか（Storybook。`pnpm storybook`）。
 *
 * **一覧の価値は網羅にしかない。** 1個でも story の無いコンポーネントがあると、
 * 「ここを見れば使えるものが分かる」が成り立たなくなり、一覧を読む理由が消える。
 * story はコンポーネントの検査（`pnpm test:storybook` の axe）と Claude Design への同期の見本も兼ねるので、
 * 書き忘れるとそのコンポーネントだけ検査からも同期の見本からも黙って抜ける。人が更新を覚えている前提の
 * 一覧は必ず腐るので、ここで機械に守らせる。
 *
 * tests/helpers/dist.ts の「ルートを列挙しない」と同じ考え方で、
 * **このテストはコンポーネントの名前を持たない。** ディレクトリを読んで、
 * 見つかったものに story があるかだけを見る。コンポーネントを足したらテストも自動で増える。
 *
 * 以前は内部ページのコンポーネント一覧（styleguide.astro）が import しているかを見ていた。
 * 一覧を Storybook に移した（rurino-nemo-fansite#96）ので、相手を story に替えた。
 */
const read = (relPath: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relPath}`, import.meta.url)), 'utf8');

const listFiles = (dir: string, ext: string) =>
  readdirSync(fileURLToPath(new URL(`../../${dir}`, import.meta.url)))
    .filter((name) => name.endsWith(ext))
    .sort();

// コンポーネントは全部 .tsx（docs/adr/0011-react-components-for-design-sync.md）。スクリプトを持つコンポーネントは、
// 同じ名前の .astro（ラッパー）が .tsx を描いてその下にスクリプトを置く。story に載るのは .tsx の方なので、
// 網羅は .tsx で数え、ラッパーは「同じ名前の .tsx を描いている」ことを見る。
const components = Object.keys(componentPathByName).map((name) => `${name}.tsx`).sort();
const wrappers = listFiles('src/components', '.astro');
const stories = listFiles('stories', '.stories.tsx');
const modules = listFiles('src/components', '.ts');
const layouts = listFiles('src/layouts', '.astro');
// docs/ は非公開のリポジトリ（rrnnm-fans-docs）を手元に置いたときだけある（RRNNM-45）。
const design = existsSync(fileURLToPath(new URL('../../docs/DESIGN.md', import.meta.url))) ? read('docs/DESIGN.md') : undefined;

const baseName = (file: string) => file.replace(/\.(stories\.)?\w+$/, '');
const storyOf = (component: string) => `${baseName(component)}.stories.tsx`;

describe('stories/ — コンポーネントの story', () => {
  it('コンポーネントと story が1つ以上ある', () => {
    // ディレクトリの読み方を間違えて空配列になると、以下の検査が全部素通りする。
    expect(components.length).toBeGreaterThan(0);
    expect(stories.length).toBeGreaterThan(0);
    expect(modules.length).toBeGreaterThan(0);
    expect(layouts.length).toBeGreaterThan(0);
  });

  it('src/components のコンポーネント（.tsx）に、同じ名前の story がある', () => {
    const missing = components.filter((name) => !stories.includes(storyOf(name)));
    expect(missing).toEqual([]);
  });

  it('story は、同じ名前のコンポーネントを import して component に渡している', () => {
    // ファイルの名前だけ合っていて別のコンポーネントを描いていると、そのコンポーネントは Storybook の一覧で
    // 別の名前の下に並び、同期でも見本が付かない。
    const mismatched = components
      .filter((name) => stories.includes(storyOf(name)))
      .filter((name) => {
        const source = read(`stories/${storyOf(name)}`);
        const sourcePath = componentPathByName[baseName(name)]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const imported = new RegExp(`^import ${baseName(name)} from '\\.\\./${sourcePath}';$`, 'm');
        const passed = new RegExp(`\\bcomponent: ${baseName(name)}\\b`);
        return !imported.test(source) || !passed.test(source);
      });
    expect(mismatched).toEqual([]);
  });

  it('story は、どれも src/components のコンポーネントに対応している', () => {
    // コンポーネントを消したのに story が残ると、無いコンポーネントが一覧に並び続ける。
    const orphans = stories.filter((story) => !components.some((name) => storyOf(name) === story));
    expect(orphans).toEqual([]);
  });

  it('ラッパーの .astro には同じ名前の .tsx があり、それを import している', () => {
    // story に載るのは .tsx だけ。ラッパーが .tsx を描かなくなると、ページが描くものと story が描くものが
    // 黙って別物になる。既定の import（`import X from`）・名前付き（`import { X } from`）・
    // その両方（`import X, { Y } from`）を受ける。値として描くための import なので、
    // 型だけの `import type` は数えない。
    expect(wrappers.length).toBeGreaterThan(0);
    const tsxOf = (astro: string) => astro.replace(/\.astro$/, '.tsx');
    const importsTsx = (tsx: string) =>
      new RegExp(
        `^import (?!type\\b)(?:\\w+|\\{[^}]*\\}|\\w+\\s*,\\s*\\{[^}]*\\})\\s+from '\\./${tsx.replace('.', '\\.')}';$`,
        'm',
      );
    const notWrapping = wrappers.filter(
      (astro) => !components.includes(tsxOf(astro)) || !importsTsx(tsxOf(astro)).test(read(`src/components/${astro}`)),
    );
    expect(notWrapping).toEqual([]);
  });

  it.skipIf(design === undefined)('src/components の .ts と src/layouts の .astro は、docs/DESIGN.md §1 の「コンポーネントではないもの」の表に載っている', () => {
    const doc = design!;
    // コンポーネントではないが同じディレクトリにいるもの（色の語彙・公式URL など）と、ページのレイアウト。
    // story にはならないので、DESIGN.md §1 の表に載せる。載っていないと、次に触る人が同じものを作り直す。
    // 同じパスは DESIGN.md のほかの節にも出てくる（Base.astro は §4 の書体の節にもある）ので、
    // ファイル全体からは探さず、この節（次の見出しまで）の表の行（| `パス` |）だけを見る。
    const start = doc.indexOf('#### コンポーネントではないもの');
    expect(start, '「コンポーネントではないもの」の見出しが無い').toBeGreaterThanOrEqual(0);
    const end = doc.indexOf('\n#', start);
    const section = doc.slice(start, end === -1 ? undefined : end);

    const missing = [
      ...modules.map((name) => `src/components/${name}`),
      ...layouts.map((name) => `src/layouts/${name}`),
    ].filter((p) => !section.includes(`| \`${p}\` |`));
    expect(missing).toEqual([]);
  });
});
