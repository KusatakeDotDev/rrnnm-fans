/**
 * axe に掛ける範囲と、見ない所。ページの規約テスト（tests/conformance/contrast.spec.ts）と
 * コンポーネントの検査（.storybook/preview.ts の parameters.a11y）の両方がここから読む。
 * 片方だけ直すと、ページとコンポーネントが黙って別の規約を見るようになるので、値はここにだけ書く。
 *
 * .storybook/preview.ts はブラウザー向けにバンドルされるので、ここでは node: のモジュールを読まない。
 */

/** WCAG 2.x の A と AA（docs/DESIGN.md §6）。 */
export const AXE_TAGS = ['wcag2a', 'wcag2aa'];

/** 第三者の埋め込み（YouTube）。中は直せないので見ない。理由は contrast.spec.ts の注記。 */
export const THIRD_PARTY_EMBED = 'iframe[src*="youtube.com"]';
