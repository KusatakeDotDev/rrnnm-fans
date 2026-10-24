/**
 * WCAG 2.x のコントラスト比（docs/DESIGN.md §4「パレットと配色ルール」・Issue rurino-nemo-fansite#9）。
 * DOM・fs・Astro に触らない（ADR-0003「層1 — 純関数だけを置く」）。
 */

/** sRGB の各チャンネル。0–255 の整数。 */
export type Rgb = { readonly r: number; readonly g: number; readonly b: number };

/** WCAG 2.x AA の下限（通常サイズの文字）。 */
export const AA_NORMAL = 4.5;

/** WCAG 2.x AA の下限（大字 = 18pt 以上、または太字 14pt 以上）。 */
export const AA_LARGE = 3;

export type TextSize = "normal" | "large";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * `#RRGGBB` を Rgb にする。3桁記法・色名・rgb() は受け付けない。渡す色（tokens.css の値、scripts の画素の色の toHex）はどれも6桁なため。
 */
export function parseHex(hex: string): Rgb {
  if (!HEX6.test(hex)) {
    throw new TypeError(`色は #RRGGBB 形式で書く: ${hex}`);
  }
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** チャンネル値（0–255）を線形化する。WCAG 2.x の定義そのまま。 */
function linearize(channel: number): number {
  const c = channel / 255;
  // Stryker disable next-line EqualityOperator: 境目の 0.03928 はチャンネル 10.0164 にあたり、0〜255 の整数はちょうどこの値を取らない
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 相対輝度。0（黒）から 1（白）。 */
export function relativeLuminance(color: Rgb): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/**
 * 2色のコントラスト比。1（同色）から 21（黒と白）。
 * どちらが前景かに依存しない。
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(parseHex(a));
  const lb = relativeLuminance(parseHex(b));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** AA を満たすか。境界（比がちょうど 4.5 / 3）は満たす側に入れる。 */
// Stryker disable next-line StringLiteral: 'large' 以外は同じ枝に入るので、既定の値を何に変えても結果が同じ
export function meetsAA(ratio: number, size: TextSize = "normal"): boolean {
  return ratio >= (size === "large" ? AA_LARGE : AA_NORMAL);
}
