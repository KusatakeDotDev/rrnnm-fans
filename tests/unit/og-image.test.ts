import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { composeOgImageSvg, ogImageHash } from '../../scripts/og-image-svg';
import { LOGO_OUTLINED } from '../../src/components/site-assets';
import { OG_IMAGE } from '../../src/layouts/og-image';

/**
 * public/og/ の画像（OGP の og:image）が、今のロゴと色から作ったものか。
 *
 * 画像は scripts/generate-og-image.mjs を手で回して作り、コミットする生成物。
 * ロゴか tokens.css の色を変えて回し忘れると、サイトと違う絵のまま公開される。ここで落とす。
 *
 * 比べるのは PNG ではなく、絵のフィンガープリント（理由は scripts/og-image-svg.ts）。
 * 画像が dist にあって大きさが合うかは、tests/conformance/ogp.spec.ts が見る。
 */
const read = (relPath: string) => readFileSync(fileURLToPath(new URL(`../../${relPath}`, import.meta.url)), 'utf8');

const tokensCss = read('src/styles/tokens.css');
const logoSvg = read(`public${LOGO_OUTLINED}`);

describe('public/og — OGP の画像', () => {
  it('今のロゴと色から組んだ絵のフィンガープリントが、OG_IMAGE.hash と合う', () => {
    expect(
      ogImageHash(composeOgImageSvg({ tokensCss, logoSvg })),
      'ロゴか色が変わった。`pnpm og:image` を回す（前の日付なら、先に日付を今日にする）',
    ).toBe(OG_IMAGE.hash);
  });
});

describe('composeOgImageSvg — 読めない入力は投げる', () => {
  /** viewBox の区切りを空白にそろえる。区切りの違いだけなら、同じ絵とみなすため。 */
  const spacedViewBox = (svg: string) => svg.replace(/viewBox="[^"]+"/g, (attr) => attr.replaceAll(',', ' '));

  it('viewBox はカンマ区切りでも、空白区切りと同じ絵に組む', () => {
    const commaLogo = logoSvg.replace(/viewBox="[^"]+"/, (attr) => attr.trim().replace(/\s+/g, ','));
    expect(commaLogo).not.toBe(logoSvg);
    expect(spacedViewBox(composeOgImageSvg({ tokensCss, logoSvg: commaLogo }))).toBe(
      spacedViewBox(composeOgImageSvg({ tokensCss, logoSvg })),
    );
  });

  it('viewBox が無いロゴは投げる', () => {
    expect(() => composeOgImageSvg({ tokensCss, logoSvg: logoSvg.replace(/\sviewBox="[^"]+"/, '') })).toThrow();
  });

  // ダークの値（RRNNM-28）の書き方は決まっていない。どの形で足されても、黙ってその色で描かない。
  // 今の tokens.css にも、コメントの中には @media の字がある。それでは投げないことは、上のフィンガープリントのテストが見ている。
  it.each([
    ['@media', '@media (prefers-color-scheme: dark) { :root { --c-ground: #000000; } }'],
    ['別のセレクタ', '[data-theme="dark"] { --c-ground: #000000; }'],
  ])('tokens.css に :root 以外のブロックがあれば投げる（%s）', (_, extra) => {
    expect(() => composeOgImageSvg({ tokensCss: `${tokensCss}\n${extra}`, logoSvg })).toThrow(/:root 以外/);
  });
});
