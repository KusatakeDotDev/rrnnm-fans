/**
 * 分類バッジの面の色。
 *
 * ここは**語彙の定義だけ**。実際の色は src/styles/tokens.css の `--color-fill-*` が持ち、
 * 面と文字色の組は src/components/CategoryBadge.tsx が持つ。
 *
 * 7色あるのは、企画の分類が7つあるため（docs/DESIGN.md §2）。
 * TODO(RRNNM-15): どの分類にどの色を当てるかを、企画スキーマを決めるときに固める。
 */
export const TONES = ["violet", "blue", "blue-deep", "ink", "pink", "pale", "amber"] as const;

export type Tone = (typeof TONES)[number];

/** 白文字を載せる濃い面。残りは本文色を載せる淡い面。 */
export const DARK_TONES: readonly Tone[] = ["violet", "blue", "blue-deep", "ink"];
