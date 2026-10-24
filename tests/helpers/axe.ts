/**
 * axe に掛ける範囲と、見ない所。ページの規約テスト（tests/conformance/routes.spec.ts）と
 * コンポーネントの検査（.storybook/preview.ts の parameters.a11y）の両方がここから読む。
 * 片方だけ直すと、ページとコンポーネントが黙って別の規約を見るようになるので、値はここにだけ書く。
 *
 * .storybook/preview.ts はブラウザー向けにバンドルされるので、ここでは node: のモジュールを読まない。
 */

/** WCAG 2.x の A と AA（docs/DESIGN.md §6）。 */
export const AXE_TAGS = ["wcag2a", "wcag2aa"];

/**
 * 第三者の埋め込み（YouTube）。axe は Playwright 経由だと cross-origin の iframe の中まで降りていくが、中は第三者の出力で
 * こちらからは直せない。直せないものを毎回赤くすると、直すべき違反が埋もれるので見ない。
 */
export const THIRD_PARTY_EMBED = 'iframe[src*="youtube.com"]';
