import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vite-plus/test';

import { COPIED_FROM_CSS, MEASURED_WITH_TOKENS } from '../../src/components/Marquee';
import { parseCustomProperties, resolve } from '../../src/lib/tokens';

/**
 * CSS の外に写した値が、写し元の CSS と同じか（RRNNM-84）。写しを CSS から読む形に寄せられないものだけを、ここで突き合わせる。
 * 写し元を変えて写しを直し忘れると、帯が右端まで届かない・ホーム画面の色が地と違う、を黙って起こすため。
 */
const read = (relPath: string) => readFileSync(fileURLToPath(new URL(`../../${relPath}`, import.meta.url)), 'utf8');

/** メディアクエリの外（広い画面）のルールの宣言。 */
function wideDeclaration(css: string, selector: string, prop: string): string | undefined {
  let found: string | undefined;
  postcss.parse(css).walkRules((rule: Rule) => {
    if (rule.selector !== selector) return;
    for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
      if (parent.type === 'atrule' && (parent as postcss.AtRule).name !== 'layer') return;
    }
    rule.walkDecls(prop, (decl) => {
      found = decl.value;
    });
  });
  return found;
}

describe('Marquee.tsx が帯を繰り返す回数を決めるのに写した値が、Marquee.module.css と同じ', () => {
  const css = read('src/components/Marquee.module.css');
  it.each([
    ['.ribbon', 'margin-inline', COPIED_FROM_CSS.ribbonMarginInline],
    ['.track', 'margin-inline-start', COPIED_FROM_CSS.trackMarginInlineStart],
    ['.band', 'font-family', COPIED_FROM_CSS.bandFontFamily],
    ['.band', 'font-size', COPIED_FROM_CSS.bandFontSize],
    ['.band', 'font-weight', COPIED_FROM_CSS.bandFontWeight],
    ['.band', 'letter-spacing', COPIED_FROM_CSS.bandLetterSpacing],
    ['.group', 'gap', COPIED_FROM_CSS.groupGap],
    ['.group', 'padding-inline-end', COPIED_FROM_CSS.groupPaddingInlineEnd],
    ['.bead', 'width', COPIED_FROM_CSS.beadSize],
    ['.bead', 'height', COPIED_FROM_CSS.beadSize],
  ])('%s の %s', (selector, prop, copied) => {
    expect(wideDeclaration(css, selector, prop)).toBe(copied);
  });

  // 帯の字の書体と間はトークンで読むので、トークンの値が測ったときから変わっても落とす。
  const tokens = parseCustomProperties(read('src/styles/tokens.css'));
  it.each(Object.entries(MEASURED_WITH_TOKENS))('tokens.css の %s', (name, measured) => {
    expect(resolve(tokens, name)).toBe(measured);
  });
});

describe('manifest の色が、地の色（tokens.css の --c-ground）と同じ', () => {
  const ground = resolve(parseCustomProperties(read('src/styles/tokens.css')), '--c-ground').toLowerCase();
  const manifest = JSON.parse(read('public/manifest.webmanifest')) as { background_color: string; theme_color: string };
  it.each(['background_color', 'theme_color'] as const)('%s', (key) => {
    expect(manifest[key].toLowerCase()).toBe(ground);
  });
});
