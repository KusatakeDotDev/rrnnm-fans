import { defineConfig } from "vite-plus";

// Vite+ の lint と整形の設定だけを置く（ADR-0031）。Astro はこのファイルを読まないが、Storybook の Vite ビルダーは読み込むので、
// Vite の設定はここに書かない（サイトは astro.config.mjs、Storybook は .storybook/main.ts に書く）。
export default defineConfig({
  lint: {
    // テストは vite-plus/test から読む。vitest を直接持つのは Stryker と addon-vitest の peer のためだけで（pnpm-workspace.yaml の catalog）、外すと vitest からの import は解決できなくなる。
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    // 型検査（typeCheck）は入れない。tsgo は TypeScript 7 で、pnpm typecheck の TypeScript 6 と2つになる（ADR-0031「型検査は、TypeScript 6 のまま」）。
    // 警告も止める。止めないと、CI が緑のまま警告が溜まる。要らなくなった disable も、Stylelint と同じく止める（ADR-0025「既知の例外は、行ごとに理由付きの disable コメントで書く」）。
    options: { typeAware: true, denyWarnings: true, reportUnusedDisableDirectives: "error" },
  },
  fmt: {
    ignorePatterns: [
      // CSS は Stylelint の決まりで書き、Oxfmt にかけない（ADR-0025「Oxlint・Oxfmt・Vite+ は CSS には使わない」）。
      "**/*.css",
      // 表の桁をそろえる空白で、毎回読み込む CLAUDE.md が 9% 増え（RRNNM-107 で減らした分）、表を直すたびに表全体が変わる。
      "**/*.md",
      // JSX のコメント（{/* */}）の * を _ に書き換えて壊す。
      "**/*.mdx",
      // scripts/skeb-summary.ts が JSON.stringify で書き出すので、整形すると書き出すたびに差分が出る。
      "src/data/skeb-summaries.json",
    ],
  },
});
