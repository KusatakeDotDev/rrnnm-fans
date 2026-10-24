// @ts-check

// ブラウザの下限は、ここ1か所に書き、サイト（astro.config.mjs）と Storybook（.storybook/main.ts）の CSS の minify に渡す
// （docs/adr/0025-native-css-and-stylelint.md「ブラウザの下限は1か所に書き、サイトと Storybook に同じ値を渡す」）。

/** iOS だけ、ほかより下げた下限。上げる条件は ADR-0025「見直す条件」。 */
export const IOS_FLOOR = 18;

export const cssTarget = ["chrome152", "edge152", "firefox155", "safari26.5", `ios${IOS_FLOOR}`];
