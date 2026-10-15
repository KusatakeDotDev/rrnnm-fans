/**
 * CSS の `@font-face` を読む。性能予算（tests/artifact/performance-budget.spec.ts）が、ページの字が当たる
 * チャンクを数えるのに使う。**ビルドに出た CSS を読む。** Fontsource の CSS の書き方が変わっても、
 * 実際に配るものを数えるため。
 */

/** `@font-face` 1つ分。宣言が無ければ `null`。 */
export interface FontFaceRule {
  family: string | null;
  /** `src` の最初の `url()`。ブラウザは読める形式のうち先に書かれたものを取りに行く。 */
  url: string | null;
  /** `unicode-range` の生の値。無ければ、その面はすべての字に当たる。 */
  unicodeRange: string | null;
}

const FONT_FACE = /@font-face\s*\{[^}]*\}/g;

/** CSS テキストの `@font-face` を、書かれた順に返す。 */
export function fontFaceRules(css: string): FontFaceRule[] {
  return (css.match(FONT_FACE) ?? []).map((block) => {
    const src = declarationValue(block, 'src');
    const url = src?.match(/url\(\s*(['"]?)([^'")]+)\1\s*\)/)?.[2] ?? null;
    return {
      family: unquote(declarationValue(block, 'font-family')),
      url,
      unicodeRange: declarationValue(block, 'unicode-range'),
    };
  });
}

/** CSS テキストから `@font-face` を外したもの。性能予算が、webfont の CSS とそれ以外を分けて測るのに使う。 */
export function withoutFontFaces(css: string): string {
  return css.replace(FONT_FACE, '');
}

/** CSS テキストの `@font-face` だけをつないだもの。 */
export function onlyFontFaces(css: string): string {
  return (css.match(FONT_FACE) ?? []).join('');
}

/** CSS テキストが `@font-face` で定義しているフォントファミリ名の一覧（書かれた順・重複あり）。 */
export function webfontFamilies(css: string): string[] {
  return fontFaceRules(css)
    .map((rule) => rule.family)
    .filter((family) => family !== null);
}

/**
 * `@font-face` ブロックから宣言1つ分の値を取り出す。無ければ `null`。
 * **ブロックの最後の宣言はセミコロンを省略できる**（minify された実物がその形）ので、`;` か `}` の手前まで拾う。
 */
function declarationValue(block: string, property: string): string | null {
  // プロパティ名の手前は必ず `{` か `;` か空白。他のプロパティ名の一部に引っかからないようにする。
  const match = block.match(new RegExp(`[{;\\s]${property}\\s*:\\s*([^;}]+)`));
  return match ? match[1].trim() : null;
}

function unquote(value: string | null): string | null {
  return value === null ? null : value.replace(/^['"]|['"]$/g, '');
}

/** コードポイントの範囲（両端を含む）。 */
export type CodePointRange = readonly [start: number, end: number];

/**
 * `unicode-range` の値を範囲の並びにする。`"U+3063"` のような単体指定と `"U+41-5A"` のような範囲指定の両方を読む。
 * 集合に展開しないのは、範囲の広い面（日本語のチャンクや、`unicode-range` の無い面）で数万から百万を超える要素になるため。
 */
export function parseUnicodeRange(range: string): CodePointRange[] {
  return range.split(',').map((part) => {
    // `-` の前後の空白は落とさなくてよい。parseInt が前後の空白を読み飛ばす。
    const [startHex, endHex] = part.trim().replace(/^U\+/i, '').split('-');
    const start = Number.parseInt(startHex, 16);
    return [start, endHex === undefined ? start : Number.parseInt(endHex, 16)] as const;
  });
}

/** `unicodeRange`（`FontFaceRule` の値）の面が、`codePoints` のどれかに当たるか。`null` はすべての字に当たる。 */
export function coversAny(unicodeRange: string | null, codePoints: Iterable<number>): boolean {
  if (unicodeRange === null) return true;
  const ranges = parseUnicodeRange(unicodeRange);
  for (const codePoint of codePoints) {
    if (ranges.some(([start, end]) => codePoint >= start && codePoint <= end)) return true;
  }
  return false;
}
