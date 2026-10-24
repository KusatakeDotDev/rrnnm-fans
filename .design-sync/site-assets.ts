// src/components/site-assets.ts の同期用の差し替え。.design-sync/tsconfig.sync.json の paths が
// エイリアス `@site-assets` をここへ向ける（Storybook では .storybook/main.ts の alias）。
// 同期の変換（esbuild）は .svg を data URL の文字列にしてバンドルに埋め込むので、
// 同期先でもサイトのルート（/logo/…）に頼らずに画像が出る。
// **名前と画像は src/components/site-assets.ts と揃える。** tests/repo/design-sync.test.ts が
// 「名前 → public/ からのパス」で突き合わせる。片方だけ足すと、同期のバンドルで undefined になる。
export { default as BRAND_BOOTH } from "../public/brand/booth-logo-icon.svg";
export { default as BRAND_MARSHMALLOW } from "../public/brand/marshmallow-logo.svg";
export { default as BRAND_SKEB } from "../public/brand/skeb-icon.svg";
export { default as BRAND_X } from "../public/brand/x-logo-white.svg";
export { default as BRAND_YOUTUBE } from "../public/brand/youtube-icon-red.svg";
export { default as LOGO_OUTLINED } from "../public/logo/rrnnm-fans-logo-outlined.svg";
export { default as LOGO_WHITE_OUTLINED } from "../public/logo/rrnnm-fans-logo-white-outlined.svg";
