/**
 * SNS に貼られたときの画像（OGP の og:image）の絵を、SVG の文字列で組む。PNG にするのは
 * scripts/generate-og-image.mjs。
 *
 * 組むところをスクリプトから分けてあるのは、tests/repo/og-image.test.ts が同じ関数で組み直して、
 * コミットした画像が今のロゴと色から作ったものかを CI で見るため。**比べるのは PNG ではなく、絵のフィンガープリント**
 * （src/layouts/og-image.ts の `hash`。組んだ SVG と、PNG にする設定から取る）。PNG のバイト列やピクセルは、
 * sharp（librsvg・libimagequant）のバージョンや OS で変わりうるので、絵が同じでも「変わった」になる。
 * SVG の文字列には、絵の入力（ロゴ・色・形）が全部入っている。sharp のバージョンはフィンガープリントに入れない（上と同じ理由）。
 *
 * ファイルは読まない。tokens.css とロゴの SVG のテキストを受け取る（読むのは呼び出し側。src/lib/tokens.ts と同じ）。
 *
 * 絵は、ページの地（青い地に白いドット）の上に、白いステッカーのカードを置き、その中にロゴを大きく出す。
 * **「非公式」は画像の中に要る。** X のカードは画像が主役で、タイトルや og:site_name が目立たない
 * （出ない形もある）。ロゴには「非公式」のラベルが入っている（docs/CONCEPT.md §2）。
 *
 * - 文字は描かない。ロゴは文字をアウトライン化した SVG（site-assets.ts の LOGO_OUTLINED）を使うので、
 *   日本語のフォントが無い環境でも同じ絵になる。文字を足すとフォントの有無で絵が変わる
 * - 色は src/styles/tokens.css の役割トークンから読む。色の literal はパレットの1箇所にしか置かない（Issue rurino-nemo-fansite#5）
 * - ご本人の画像は使わない（docs/CONCEPT.md §3）
 */
import { createHash } from 'node:crypto';

import { OG_IMAGE } from '../src/layouts/og-image.ts';
import { parseCustomProperties, resolve, stripComments } from '../src/lib/tokens.ts';

/**
 * サイトのカード（Card.module.css）とドット（global.css の body::before）を、この倍率で描く。
 * SNS では画像が半分以下に縮んで出るので、サイトと同じ太さでは枠もドットも潰れる。
 */
const SCALE = 1.5;

/**
 * ロゴの幅と、カードの枠の内側の余白。縮んだプレビュー（幅 500px ほど）でも「非公式」のラベルが読める大きさにする。
 *
 * **中央を正方形に切る表示は考えない。** ラベルはロゴの右上にあるので、そう切られると欠ける。
 * ロゴを中央の正方形（630px）に収まる幅まで縮めると、横長のまま出るカードでラベルが読めなくなる。
 * 大きい画像のカード（twitter:card の summary_large_image）は横長のまま出るものとして組む
 * （どの SNS が正方形に切るかは確かめていない）。正方形に切られても、og:title と og:site_name には「非公式」が入る。
 */
const LOGO_WIDTH = 920;
const CARD_PADDING_X = 58;
const CARD_PADDING_Y = 50;

/** tokens.css とロゴの SVG から、OG_IMAGE の大きさの絵を組む。読めない形なら投げる。 */
export function composeOgImageSvg({ tokensCss, logoSvg }: { tokensCss: string; logoSvg: string }): string {
  // parseCustomProperties は、セレクタも @media も見ずに後の値を採る。今の tokens.css は `:root` の
  // ブロック1つだけ。ダークの値（RRNNM-28）などで別のブロックが入ると、画像が黙ってその色で描かれる。
  // そうなったら、ライトの `:root` だけを読むようにここを直す。
  if (!/^\s*:root\s*\{[^{}]*\}\s*$/.test(stripComments(tokensCss))) {
    throw new Error('tokens.css に :root 以外のブロックがある。ライトの値だけを読むように composeOgImageSvg を直す');
  }
  const tokens = parseCustomProperties(tokensCss);
  const color = (name: string) => resolve(tokens, name);
  const ground = color('--color-bg');
  const surface = color('--color-surface');
  const outline = color('--color-outline');
  const decor = color('--color-decor');
  /** 長さのトークンを px で読む。rem はルート 16px で px にする（サイトの既定の文字の大きさ）。 */
  const length = (name: string) => {
    const value = resolve(tokens, name);
    const match = /^(\d*\.?\d+)(px|rem)$/.exec(value);
    if (!match) throw new Error(`${name} を長さとして読めない（${value}）`);
    return Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
  };
  const BORDER = length('--border-card') * SCALE;
  const OFFSET = length('--offset-card') * SCALE;
  const RADIUS = length('--radius-card') * SCALE;
  const DOT_GAP = length('--dot-gap') * SCALE;
  // ドットは、ぼかし（--dot-radius から --dot-edge まで）の中ほどの半径の円で描く。
  const DOT_RADIUS = ((length('--dot-radius') + length('--dot-edge')) / 2) * SCALE;
  const DOT_OPACITY = Number(resolve(tokens, '--dot-opacity'));

  const logoMatch = logoSvg.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>/);
  const viewBox = logoMatch?.[1]?.match(/\sviewBox="([^"]+)"/)?.[1];
  // viewBox は空白でもカンマでも区切れる（SVG の仕様）。
  const [, , vbWidth = NaN, vbHeight = NaN] = viewBox?.trim().split(/[\s,]+/).map(Number) ?? [];
  if (!logoMatch || !viewBox || !(vbWidth > 0) || !(vbHeight > 0)) {
    throw new Error('ロゴの <svg> と viewBox を読めなかった');
  }
  const logoHeight = Math.round((LOGO_WIDTH * vbHeight) / vbWidth);

  const { width, height } = OG_IMAGE;
  // カードの外形（枠を含む。CSS の border-box と box-shadow と同じ形）。
  const cardWidth = LOGO_WIDTH + (CARD_PADDING_X + BORDER) * 2;
  const cardHeight = logoHeight + (CARD_PADDING_Y + BORDER) * 2;
  // ずらした影のぶんも含めた塊を、画面の真ん中に置く。整数に丸めないと、枠の縁がにじむ。
  const cardX = Math.round((width - cardWidth - OFFSET) / 2);
  const cardY = Math.round((height - cardHeight - OFFSET) / 2);
  if (cardX < 0 || cardY < 0) {
    throw new Error('カードが画面からはみ出す。LOGO_WIDTH か余白を小さくする');
  }

  // SVG の線は形の縁をまたいで引かれる。枠が外形の内側に収まるよう、面を枠の半分だけ縮めて線を引く。
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <pattern id="dots" width="${DOT_GAP}" height="${DOT_GAP}" patternUnits="userSpaceOnUse">
      <circle cx="${DOT_GAP / 2}" cy="${DOT_GAP / 2}" r="${DOT_RADIUS}" fill="${decor}" fill-opacity="${DOT_OPACITY}" />
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="${ground}" />
  <rect width="${width}" height="${height}" fill="url(#dots)" />
  <rect x="${cardX + OFFSET}" y="${cardY + OFFSET}" width="${cardWidth}" height="${cardHeight}" rx="${RADIUS}" fill="${outline}" />
  <rect x="${cardX + BORDER / 2}" y="${cardY + BORDER / 2}" width="${cardWidth - BORDER}" height="${cardHeight - BORDER}" rx="${RADIUS - BORDER / 2}" fill="${surface}" stroke="${outline}" stroke-width="${BORDER}" />
  <svg x="${cardX + BORDER + CARD_PADDING_X}" y="${cardY + BORDER + CARD_PADDING_Y}" width="${LOGO_WIDTH}" height="${logoHeight}" viewBox="${viewBox}">
    ${logoMatch[2]}
  </svg>
</svg>`;
}

/** SVG を PNG にする設定（sharp の png()）。変えると絵が変わりうるので、フィンガープリントに入れる。 */
export const PNG_OPTIONS = { compressionLevel: 9, palette: true } as const;

/** 絵のフィンガープリント。組んだ SVG と PNG_OPTIONS から取る。src/layouts/og-image.ts の `hash` と比べる。 */
export function ogImageHash(svg: string): string {
  return createHash('sha256').update(svg).update(JSON.stringify(PNG_OPTIONS)).digest('hex').slice(0, 16);
}
