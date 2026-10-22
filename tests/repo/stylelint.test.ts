import { fileURLToPath } from 'node:url';

import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';

/**
 * stylelint.config.mjs の自前の構文とルール、disable の決まりが効くかを、本物の設定で見る（ADR-0025「既知の例外は、
 * 行ごとに理由付きの disable コメントで書く」「ネストは、3つの経路で同じ意味になる書き方だけで使う」）。
 * 組み込みのルールそのものは Stylelint が確かめているので、ここでは組み方（自前のコードと設定の効き方）だけを見る。
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * `file` は、リポジトリの中のどこにあるものとして lint するか（設定の overrides がパスで決まるため）。
 * `layer` を渡すと、CSS（.astro では各 <style> の中身）をそのレイヤーのブロックで包んでから読む。行は変えない。
 */
async function lint(code: string, file: string, layer?: string): Promise<string[]> {
  if (layer) code = file.endsWith('.astro') ? inAstroLayer(code, layer) : `@layer ${layer} { ${code.replace(/\n$/, '')} }\n`;
  const { results } = await stylelint.lint({ code, codeFilename: `${ROOT}${file}`, configBasedir: ROOT, cwd: ROOT });
  const [result] = results;
  return [
    ...(result?.warnings ?? []).map((w) => `${w.rule}@${w.line}`),
    ...(result?.parseErrors ?? []).map((w) => `parse@${w.line}`),
  ].sort();
}

function inAstroLayer(code: string, layer: string): string {
  return code.replace(/(<style\b[^>]*>)\n/g, `$1\n@layer ${layer} { `).replace(/\n([ \t]*)<\/style>/g, ' }\n$1</style>');
}

const CSS = 'src/components/Example.module.css';
const ASTRO = 'src/pages/example.astro';

describe('.astro の <style> を読む', () => {
  it('<style> の中の違反を、.astro の行で指す', async () => {
    const code = ['---', "const a = 1;", '---', '<p>a</p>', '<style>', '  .a {', '    color: #fff;', '  }', '</style>', ''].join('\n');
    expect(await lint(code, ASTRO, 'pages')).toEqual(['color-no-hex@7']);
  });

  it('行の頭にない `<style>` の文字は、CSS の始まりと読まない', async () => {
    const code = ['---', '// ここで <style> と書いても読まない', "const s = '<style>';", '---', '<style>', '  .a { color: var(--color-text); }', '</style>', ''].join('\n');
    expect(await lint(code, ASTRO, 'pages')).toEqual([]);
  });

  it('インデントした <style> も読む', async () => {
    const code = ['<div>', '  <style>', '    .a { color: #fff; }', '  </style>', '</div>', ''].join('\n');
    expect(await lint(code, ASTRO, 'pages')).toEqual(['color-no-hex@3']);
  });

  it('<style> が2つあれば、どちらも読む', async () => {
    const code = ['<style>', '  .a { color: #000; }', '</style>', '<style is:global>', '  .b { color: #111; }', '</style>', ''].join('\n');
    expect(await lint(code, ASTRO, 'pages')).toEqual(['color-no-hex@2', 'color-no-hex@5']);
  });

  it('.astro の <style> ではネストしない', async () => {
    expect(await lint('<style>\n  .a { .b { color: var(--color-text); } }\n</style>\n', ASTRO, 'pages')).toEqual(['rrnnm/no-nesting@2']);
  });
});

describe('ネスト', () => {
  it('ネストしたルールより後ろに宣言を書くと落ちる', async () => {
    expect(await lint('.a {\n  .b { color: var(--color-text); }\n  color: var(--color-text);\n}\n', CSS, 'components')).toEqual([
      'rrnnm/declarations-before-nested-rules@3',
    ]);
  });

  it('宣言を先に書けば通る', async () => {
    expect(await lint('.a {\n  color: var(--color-text);\n  .b { color: var(--color-text); }\n}\n', CSS, 'components')).toEqual([]);
  });

  it('擬似要素の下にネストすると落ちる', async () => {
    expect(await lint('.a::before {\n  .b { color: var(--color-text); }\n}\n', CSS, 'components')).toEqual(['rrnnm/no-nesting-under-pseudo-element@2']);
  });

  it('擬似要素の下に @media を挟んでネストしても落ちる', async () => {
    const code = '.a::before {\n  @media (max-width: 40rem) {\n    .b { color: var(--color-text); }\n  }\n}\n';
    expect(await lint(code, CSS, 'components')).toEqual(['rrnnm/no-nesting-under-pseudo-element@3']);
  });
});

describe('カスタムプロパティのフォールバック', () => {
  it('トークンにフォールバックを付けると落ちる', async () => {
    expect(await lint('.a { color: var(--color-text, var(--color-link)); }\n', CSS, 'components')).toEqual(['rrnnm/custom-property-fallback@1']);
  });

  it('受け付ける変数のフォールバックは、トークン・キーワード・0 なら通り、ほかは落ちる', async () => {
    const ok = '.a { transform: rotate(var(--tilt, 0deg)); color: var(--ink, var(--color-text)); mask: var(--m, none); }\n';
    expect(await lint(ok, CSS, 'components')).toEqual([]);
    expect(await lint('.a { width: var(--w, 3rem); }\n', CSS, 'components')).toEqual(['rrnnm/custom-property-fallback@1']);
  });

  it('トークンにも、このファイルにも無い変数を、フォールバック無しで読むと落ちる', async () => {
    expect(await lint('.a { color: var(--nowhere); }\n', CSS, 'components')).toEqual(['no-unknown-custom-properties@1']);
    expect(await lint('.a { --here: 1rem; width: var(--here); }\n', CSS, 'components')).toEqual([]);
  });
});

describe('例外の disable', () => {
  it('行ごとの disable に理由を書けば、その行だけ外れる', async () => {
    const code = '.a {\n  /* stylelint-disable-next-line color-no-hex -- 理由 */\n  color: #fff;\n  background: #000;\n}\n';
    expect(await lint(code, CSS, 'components')).toEqual(['color-no-hex@4']);
  });

  it('理由の無い disable は落ちる', async () => {
    const code = '.a {\n  /* stylelint-disable-next-line color-no-hex */\n  color: #fff;\n}\n';
    expect(await lint(code, CSS, 'components')).toEqual(['--report-descriptionless-disables@2']);
  });

  it('要らない disable は落ちる', async () => {
    const code = '.a {\n  /* stylelint-disable-next-line color-no-hex -- 理由 */\n  color: var(--color-text);\n}\n';
    expect(await lint(code, CSS, 'components')).toEqual(['--report-needless-disables@2']);
  });

  it('範囲の disable は、ルールを名指ししても落ちる', async () => {
    const code = '/* stylelint-disable color-no-hex -- 理由 */\n.a { color: #fff; }\n/* stylelint-enable color-no-hex */\n';
    expect(await lint(code, CSS, 'components')).toEqual(['rrnnm/disable-next-line-only@1', 'rrnnm/disable-next-line-only@3']);
  });

  it('行の中の disable（stylelint-disable-line）は、理由を書いても落ちる', async () => {
    const code = '.a {\n  color: #fff; /* stylelint-disable-line color-no-hex -- 理由 */\n}\n';
    expect(await lint(code, CSS, 'components')).toEqual(['rrnnm/disable-next-line-only@2']);
  });

  it('ルールを名指ししない disable は落ちる', async () => {
    const code = '.a {\n  /* stylelint-disable-next-line -- 理由 */\n  color: #fff;\n}\n';
    expect(await lint(code, CSS, 'components')).toContain('--report-unscoped-disables@2');
  });

  it('!important は、disable しても落ちる', async () => {
    const code = '.a {\n  /* stylelint-disable-next-line declaration-no-important -- 理由 */\n  color: var(--color-text) !important;\n}\n';
    expect(await lint(code, CSS, 'components')).toContain('reportDisables@2');
  });
});

describe('lint の範囲', () => {
  it('src/unreleased/ では、値のルールを掛けない', async () => {
    expect(await lint('.a { color: #fff; font-size: 13px; }\n', 'src/unreleased/_parts/Example.module.css', 'components')).toEqual([]);
  });

  it('src/unreleased/ でも、構文のルールは掛ける', async () => {
    expect(await lint('.a { color: red !important; }\n', 'src/unreleased/_parts/Example.module.css', 'components')).toEqual(['declaration-no-important@1']);
  });
});

describe('レイヤー', () => {
  it('CSS Modules は components のブロックに入れれば通り、外に書くか、ほかのレイヤーに入れると落ちる', async () => {
    expect(await lint('@layer components {\n  .a { color: var(--color-text); }\n}\n', CSS)).toEqual([]);
    expect(await lint('.a { color: var(--color-text); }\n', CSS)).toEqual(['rrnnm/layer-by-path@1']);
    expect(await lint('@layer pages {\n  .a { color: var(--color-text); }\n}\n', CSS)).toEqual(['rrnnm/layer-by-path@1']);
  });

  it('@property も、レイヤーのブロックに入れる', async () => {
    const property = "@property --x { syntax: '<color>'; inherits: true; initial-value: transparent; }";
    expect(await lint(`@layer components {\n  ${property}\n}\n`, CSS)).toEqual([]);
    expect(await lint(`${property}\n@layer components {\n  .a { color: var(--x); }\n}\n`, CSS)).toEqual(['rrnnm/layer-by-path@1']);
  });

  it('レイヤーの中に、レイヤーを入れると落ちる', async () => {
    expect(await lint('@layer components {\n  @layer inner {\n    .a { color: var(--color-text); }\n  }\n}\n', CSS)).toEqual(['rrnnm/layer-by-path@2']);
  });

  it('順の宣言は layers.css にだけ書き、layers.css には順の宣言だけを書く', async () => {
    expect(await lint('@layer base, components;\n@layer components {\n  .a { color: var(--color-text); }\n}\n', CSS)).toEqual(['rrnnm/layer-by-path@1']);
    expect(await lint('@layer base, layout;\n', 'src/styles/layers.css')).toEqual([]);
    expect(await lint('@layer base, layout;\n.a { color: var(--color-text); }\n', 'src/styles/layers.css')).toEqual(['rrnnm/layer-by-path@2']);
  });

  it('tokens.css と @font-face のファイルには、@layer を書かない', async () => {
    expect(await lint(':root {\n  --x: 1px;\n}\n', 'src/styles/tokens.css')).toEqual([]);
    expect(await lint('@layer base {\n  :root { --x: 1px; }\n}\n', 'src/styles/tokens.css')).toEqual(['rrnnm/layer-by-path@1']);
  });

  it('global.css には、base・layout・utilities のブロックを置ける', async () => {
    const code = '@layer base {\n  a { color: var(--color-link); }\n}\n@layer layout {\n  .b { max-width: 1rem; }\n}\n@layer utilities {\n  .c { color: var(--color-text); }\n}\n';
    expect(await lint(code, 'src/styles/global.css')).toEqual([]);
  });

  it('置き場所にレイヤーの決まっていないファイルは落ちる', async () => {
    expect(await lint('@layer components {\n  .a { color: var(--color-text); }\n}\n', 'src/apps/example/Example.module.css')).toEqual([
      'rrnnm/layer-by-path@1',
    ]);
  });

  it('レイヤーのルールは、disable しても落ちる', async () => {
    const code = '/* stylelint-disable-next-line rrnnm/layer-by-path -- 理由 */\n.a { color: var(--color-text); }\n';
    expect(await lint(code, CSS)).toContain('reportDisables@1');
  });

  it('.astro の <style> では、@layer の中の @media と @keyframes は通し、ルールの中のネストは落とす', async () => {
    const ok = [
      '<style>',
      '  @layer pages {',
      '    .a { color: var(--color-text); }',
      '    @media (max-width: 40rem) {',
      '      .a { color: var(--color-text); }',
      '    }',
      '    @keyframes pop {',
      '      from { opacity: 0; }',
      '    }',
      '  }',
      '</style>',
      '',
    ].join('\n');
    expect(await lint(ok, ASTRO)).toEqual([]);
    const nested = '<style>\n  @layer pages {\n    .a {\n      @media (max-width: 40rem) { color: var(--color-text); }\n    }\n  }\n</style>\n';
    expect(await lint(nested, ASTRO)).toEqual(['rrnnm/no-nesting@4']);
  });

  it('自分で閉じる <style … />（中身を set:html で入れる）は、CSS の始まりと読まない', async () => {
    const code = ['<head>', '  <style is:inline set:html={css} />', '</head>', '<p>{a}</p>', '<style>', '  @layer layout {', '    .a { color: #fff; }', '  }', '</style>', ''].join('\n');
    expect(await lint(code, 'src/layouts/Example.astro')).toEqual(['color-no-hex@7']);
  });

  it('ページの :global() には、子のコンポーネントに渡したクラスか id を1つだけ、セレクタの最後に書く', async () => {
    const code = [
      '<style>',
      '  @layer pages {',
      '    .s :global(.x) { margin-top: var(--space-4); }',
      '    .s > :global(#y), .t :global(.z) { scroll-margin-top: var(--space-4); }',
      '    .s :global(blockquote.twitter-tweet p) { margin: 0; }',
      '    ul > :global(li + li) { margin-top: 0; }',
      '    :global(.x) .inner { margin: 0; }',
      '    .s:global(.open) { margin: 0; }',
      '  }',
      '</style>',
      '',
    ].join('\n');
    expect(await lint(code, ASTRO)).toEqual([
      'rrnnm/page-global-selector@5',
      'rrnnm/page-global-selector@6',
      'rrnnm/page-global-selector@7',
      'rrnnm/page-global-selector@8',
    ]);
  });

  it('子のコンポーネントの root には、置き方と、コンポーネントが受け付ける変数だけを書ける', async () => {
    const code = [
      '<style>',
      '  @layer pages {',
      '    .s :global(.x) { margin-top: var(--space-4); z-index: 1; transform: rotate(1deg); --thumb-radius: var(--radius-thumb); }',
      '    .s :global(.y) { color: var(--color-text); padding: 0; }',
      '    .s :global(.z) { --scallop: 0; }',
      '    .s .own { padding: 0; }',
      '  }',
      '</style>',
      '',
    ].join('\n');
    expect(await lint(code, ASTRO)).toEqual([
      'rrnnm/page-places-components@4',
      'rrnnm/page-places-components@4',
      'rrnnm/page-places-components@5',
    ]);
  });

  it(':root にカスタムプロパティを書くのは tokens.css だけ', async () => {
    expect(await lint(':root { --x: 1px; }\n', CSS, 'components')).toEqual(['rule-selector-property-disallowed-list@1']);
  });

  it('text-decoration のショートハンドは、src/unreleased/ でも書かない', async () => {
    expect(await lint('.a { text-decoration: none; }\n', CSS, 'components')).toEqual(['property-disallowed-list@1']);
    expect(await lint('.a { text-decoration: none; }\n', 'src/unreleased/_parts/Example.module.css', 'components')).toEqual([
      'property-disallowed-list@1',
    ]);
  });
});

describe('余白のトークン', () => {
  it('余白は var(--space-N) で書き、rem・px を直に書くと落ちる。0・auto・em・負の値・vw・% は通る', async () => {
    const code = [
      '.a {',
      '  padding: var(--space-4) 1rem;',
      '  margin: 0 auto -1rem;',
      '  gap: clamp(var(--space-2), 2vw, 1em);',
      '  scroll-margin-top: 12px;',
      '  padding-inline: 5%;',
      '}',
      '',
    ].join('\n');
    expect(await lint(code, CSS, 'components')).toEqual(['rrnnm/space-token@2', 'rrnnm/space-token@5']);
  });

  it('余白でないトークンを余白に読むと落ち、コンポーネントの中の変数は通る', async () => {
    const code = '.a {\n  --pad: var(--space-4);\n  padding: var(--radius-card);\n  margin: var(--pad);\n}\n';
    expect(await lint(code, CSS, 'components')).toEqual(['rrnnm/space-token@3']);
  });

  it('src/unreleased/ では、余白のルールを掛けない', async () => {
    expect(await lint('.a { padding: 1rem; }\n', 'src/unreleased/_parts/Example.module.css', 'components')).toEqual([]);
  });

  it('tokens.css の --space-N は N × 0.25rem にする', async () => {
    expect(await lint(':root {\n  --space-4: 1rem;\n  --space-5: 1.5rem;\n  --space-x: 1rem;\n}\n', 'src/styles/tokens.css')).toEqual([
      'rrnnm/space-token-scale@3',
      'rrnnm/space-token-scale@4',
    ]);
  });
});

describe('コンテナ', () => {
  it('コンテナには名前を付けず、container-type だけを書く', async () => {
    const code = '.a {\n  container-type: inline-size;\n  container-name: grid;\n  container: grid / inline-size;\n}\n';
    expect(await lint(code, CSS, 'components')).toEqual(['property-disallowed-list@3', 'property-disallowed-list@4']);
  });
});
