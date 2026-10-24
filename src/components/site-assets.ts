/**
 * コンポーネントが使う画像（public/ の下）のパス。
 *
 * コンポーネントはここを相対パスではなくエイリアス `@site-assets` で読む（tsconfig.json の paths）。
 * サイトではこのファイルが使われ、パスは public/ のまま出る。
 * Claude Design へ同期するときと Storybook（.storybook/main.ts。同期のスクリーンショット比較の正解になる）では、
 * エイリアスの行き先を .design-sync/site-assets.ts に差し替え、同じ名前で画像を data URL にして埋め込む
 * （仕組みは .design-sync/NOTES.md）。
 * **名前を足したら、.design-sync/site-assets.ts にも同じ名前・同じ画像を足す**
 * （tests/repo/design-sync.test.ts が名前と画像のパスを突き合わせる）。
 *
 * `src/lib` に置かないのは、あそこが純関数だけの層でミューテーションテストの対象だから。
 *
 * 外部サービスのロゴ（BRAND_*）の利用条件は public/brand/NOTICE.txt と docs/BRAND_ASSETS.md。
 */
export const LOGO_OUTLINED = "/logo/rrnnm-fans-logo-outlined.svg";
export const LOGO_WHITE_OUTLINED = "/logo/rrnnm-fans-logo-white-outlined.svg";
export const BRAND_YOUTUBE = "/brand/youtube-icon-red.svg";
export const BRAND_X = "/brand/x-logo-white.svg";
export const BRAND_MARSHMALLOW = "/brand/marshmallow-logo.svg";
export const BRAND_BOOTH = "/brand/booth-logo-icon.svg";
export const BRAND_SKEB = "/brand/skeb-icon.svg";
