// @ts-check
/**
 * CSS の決まり。本文はこのコメントと、違反のメッセージにある（どちらにもなぜを書く）。出どころはどれも ADR-0025。
 * 例外は、行ごとの `stylelint-disable-next-line <ルール> -- <理由>` で書く。
 *
 * lint で守る（下の rules。メッセージに ADR-0025 の節の名前を書く）:
 * - `@custom-media` を使わず、ブレークポイントは `@media (max-width: 40rem)` か `60rem` にする。
 * - `!important` を書かない。例外の disable もさせない。
 * - 下限のブラウザのための接頭辞（`-webkit-` など）を手で書かない。書き換えは minify に任せる。
 * - 下限の iOS 18 で読めない機能を書かない（stylelint-plugin-use-baseline、Baseline 2024）。
 * - 色の literal は tokens.css にだけ書く。文字の大きさは `var(--text-*)` か em、角丸は `var(--radius-*)`・`50%`・`0`・
 *   `var(--受け付ける変数, var(--radius-*))`・`calc()` で書く（src/unreleased/ は公開する PR から。ADR-0018）。
 * - 余白（gap・padding・margin・scroll-margin・scroll-padding）は `var(--space-N)` で書く（0・auto・em・負の値・vw・% は除く。
 *   src/unreleased/ は公開する PR から）。tokens.css の `--space-N` は N × 0.25rem にする。
 * - トークンはフォールバックを付けずに読み、無い名前を書かない。コンポーネントが受け付ける変数は、
 *   トークン・キーワード・0 のどれかをフォールバックにして読む（src/unreleased/ は公開する PR から）。
 * - ネストは、宣言を先に書き、擬似要素の下では使わない。`.astro` の `<style>` では使わない。
 * - CSS は、置き場所で決まるレイヤーのブロックに入れる（下の overrides の `rrnnm/layer-by-path`）。順の宣言は
 *   src/styles/layers.css にだけ書き、tokens.css と @font-face のファイルはレイヤーの外に置く。例外の disable もさせない。
 * - ページの `:global()` には、子のコンポーネントに渡したクラスか id を1つだけ、セレクタの最後に書く。そこ（子のコンポーネントの root）には、
 *   置き方と、コンポーネントが受け付ける変数だけを書く。
 * - `:root` にカスタムプロパティを書くのは tokens.css だけ。`text-decoration` のショートハンドは書かない。
 * - `@container` のコンテナには名前を付けない（`container-name` と `container` のショートハンドを書かず、`container-type` だけ）。
 * - 例外は `stylelint-disable-next-line` だけで書き、範囲の disable（`stylelint-disable` … `stylelint-enable`）と
 *   行の中の disable（`stylelint-disable-line`）は書かない。理由の無い・要らない・範囲の誤った・ルールを名指ししない disable も書かない。
 *
 * テストで守る:
 * - サイトと Storybook が、同じブラウザの下限で minify する（tests/repo/browser-targets.test.ts）。
 * - ビルドした各ページで、レイヤーが layers.css の順に並ぶ（tests/artifact/css-layers.spec.ts）。
 * - CSS Modules を持つコンポーネントは、root の要素に `.root` を付け、ほかの要素には付けない（tests/repo/component-root-class.test.ts）。
 *
 * lint でもテストでも守らない（レビューで見る）:
 * - 例外の行の値と、理由の中身。
 * - utilities（global.css の `.on-paper`・`.on-ground`・`.tabular`・`.sr-only`）の中身を、使う側で上書きしない。
 * - コンポーネントの中だけで使う変数（フォールバック無しで読むもの。Marquee の `--scallop` など）を、外から書かない。
 * - コンポーネントが受け付ける変数の名前を短く保つ（`--tilt`・`--thumb-radius`）。
 * - 親から決まる幅で変えるものは `@container`、画面の幅で変えるものは `@media` で書く。root をコンテナにし、見た目と余白は
 *   中の要素に置く。コンテナにするのは、幅が外から決まる要素だけ（幅の無い flex の子・inline-block は幅が 0 につぶれる）。
 *   `@container` の条件は max-width と rem で書き、値はコンポーネントごとに決める。
 * - トークンは、名前でデザインの意図を表せるなら、1か所でも作る（`--offset-pressed`・`--tap-size`・`--anchor-offset`）。
 *   出てくる数では決めず、同じ値の3か所目は、意図を見直すきっかけにする。
 */
import rules from "./scripts/stylelint/rules.mjs";

/** @param {string} rule @param {string} section */
const msg = (rule, section) => `${rule}（ADR-0025「${section}」）`;

const NESTING = "ネストは、3つの経路で同じ意味になる書き方だけで使う";
/** 置き場所で決まるレイヤー。`reportDisables` は、overrides でオプションを丸ごと置き換えても残るよう、ここで付ける。 */
const layerBy = (/** @type {object} */ options) => [true, { ...options, reportDisables: true }];
const PREFIX = msg(
  "下限のブラウザのための接頭辞を手で書かない。下限のブラウザはどれも接頭辞の無い形を読み、要るものは minify（Lightning CSS）が足す",
  "ブラウザの下限は1か所に書き、サイトと Storybook に同じ値を渡す",
);
const COLOR = msg(
  "色の literal は src/styles/tokens.css にだけ書き、ここではトークンを読む。2か所に書くと、配色を替えたときに片方が残る",
  "余白は 4px 刻みのトークンにし、切り上げて丸める",
);

/** 値（トークン）のルール。src/unreleased/ では、公開する PR まで掛けない。 */
const valueRules = {
  "color-no-hex": [true, { message: COLOR }],
  "color-named": ["never", { message: COLOR }],
  "function-disallowed-list": [
    ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color"],
    { message: COLOR },
  ],
  "declaration-property-value-allowed-list": [
    {
      "font-size": [/^var\(--text-[\w-]+\)$/, /^[\d.]+em$/],
      "/radius$/": [
        /^var\(--radius-[\w-]+\)$/,
        "50%",
        "0",
        /^var\(--[\w-]+, var\(--radius-[\w-]+\)\)$/,
        /^calc\([^;]*\)$/,
      ],
    },
    {
      message: msg(
        "文字の大きさは var(--text-*) か em、角丸は var(--radius-*)・50%・0・var(--受け付ける変数, var(--radius-*))・calc() で書く。トークンの外の値は、デザインの段を黙って増やす",
        "余白は 4px 刻みのトークンにし、切り上げて丸める",
      ),
    },
  ],
  "no-unknown-custom-properties": [
    true,
    {
      message: msg(
        "トークン（src/styles/tokens.css）にも、このファイルにも無いカスタムプロパティを、フォールバック無しで読まない。打ち間違いに気付けない",
        "カスタムプロパティは、フォールバックの有無で役を分ける",
      ),
    },
  ],
  "rrnnm/custom-property-fallback": true,
  "rrnnm/space-token": true,
};

/** @type {import('stylelint').Config} */
export default {
  plugins: ["stylelint-plugin-use-baseline", ...rules],
  referenceFiles: ["src/styles/tokens.css"],
  reportNeedlessDisables: true,
  reportDescriptionlessDisables: true,
  reportInvalidScopeDisables: true,
  reportUnscopedDisables: true,
  rules: {
    "at-rule-disallowed-list": [
      ["custom-media"],
      {
        message: msg(
          "@custom-media は使わない。どのブラウザもまだ読まず、同期の esbuild は黙って通す",
          "`@custom-media` は使わず、ブレークポイントは決まった値で書く",
        ),
      },
    ],
    "media-feature-name-allowed-list": [
      ["max-width", "prefers-reduced-motion", "forced-colors", "hover"],
      {
        message: msg(
          "ブレークポイントは max-width で書く。ほかに使ってよいのは、幅で分けない prefers-reduced-motion・forced-colors・hover だけ",
          "`@custom-media` は使わず、ブレークポイントは決まった値で書く",
        ),
      },
    ],
    "media-feature-name-value-allowed-list": [
      { "max-width": ["40rem", "60rem"] },
      {
        message: msg(
          "ブレークポイントは 40rem（狭い画面の境目）か 60rem（再生リストを4列から3列にする幅）にする。var() はメディアクエリで使えないので、使ってよい値を lint で守る",
          "`@custom-media` は使わず、ブレークポイントは決まった値で書く",
        ),
      },
    ],
    "declaration-no-important": [
      true,
      {
        reportDisables: true,
        message: msg(
          "!important を書かない。勝ち負けはレイヤーの順で決める",
          "レイヤーは5つにし、pages を最後の手段にする",
        ),
      },
    ],
    "keyframe-declaration-no-important": [
      true,
      {
        message: msg(
          "!important を書かない（キーフレームの中では無視される）",
          "レイヤーは5つにし、pages を最後の手段にする",
        ),
      },
    ],
    // 接頭辞の無い形が Baseline に無く、手で書くしかないものは外す（RRNNM-76 の決定）。
    "property-no-vendor-prefix": [
      true,
      { ignoreProperties: ["-webkit-text-size-adjust", "-webkit-user-select"], message: PREFIX },
    ],
    "value-no-vendor-prefix": [true, { message: PREFIX }],
    "selector-no-vendor-prefix": [true, { message: PREFIX }],
    "media-feature-name-no-vendor-prefix": [true, { message: PREFIX }],
    "at-rule-no-vendor-prefix": [true, { message: PREFIX }],
    "plugin/use-baseline": [
      true,
      {
        available: 2024,
        message: msg(
          "下限の iOS 18 で読めない機能を書かない。minify は機能を足さないので、書いてもビルドは通る",
          "下限で読めない機能は、Baseline 2024 で lint する",
        ),
      },
    ],
    "rrnnm/declarations-before-nested-rules": true,
    "rrnnm/no-nesting-under-pseudo-element": true,
    "rrnnm/disable-next-line-only": [true, { reportDisables: true }],
    // 置き場所とレイヤーの対応は overrides に書く。どれにも当たらないファイルは、ここで落ちる。
    "rrnnm/layer-by-path": layerBy({}),
    "rule-selector-property-disallowed-list": [
      { "/:root/": ["/^--/"] },
      {
        message: msg(
          ":root にカスタムプロパティを書くのは tokens.css だけ。tokens.css はレイヤーの外にあり、レイヤーの中の :root では上書きできない",
          "`tokens.css` と `@font-face` のファイルはレイヤーの外、CSS Modules と `<style>` は中に置く",
        ),
      },
    ],
    "property-disallowed-list": [
      ["text-decoration", "container", "container-name"],
      {
        message: (/** @type {string} */ property) =>
          property === "text-decoration"
            ? msg(
                "text-decoration のショートハンドは書かず、text-decoration-line などで書く。ショートハンドは、下のレイヤーの a:hover の太さ（text-decoration-thickness）まで消す",
                "レイヤーは5つにし、pages を最後の手段にする",
              )
            : msg(
                "コンテナに名前を付けず、container-type だけを書く。サイトの CSS Modules はコンテナの名前をローカルにせず、同期の esbuild はファイルごとにローカルにするので、効く範囲がサイトと同期で変わる",
                "置かれた幅に合わせるときは `@container` にし、root をコンテナにする",
              ),
      },
    ],
    ...valueRules,
  },
  overrides: [
    {
      files: ["**/*.astro"],
      customSyntax: "./scripts/stylelint/astro-syntax.mjs",
      rules: {
        "rrnnm/no-nesting": [
          true,
          {
            message: msg(
              ".astro の <style> ではネストしない。ネストの中の子孫セレクタにスコープが付かず、子のコンポーネントまで当たる",
              NESTING,
            ),
          },
        ],
      },
    },
    {
      // トークンを定義する場所なので、色・大きさ・角丸の literal と、:root のカスタムプロパティを許す。
      files: ["src/styles/tokens.css"],
      rules: {
        "color-no-hex": null,
        "color-named": null,
        "function-disallowed-list": null,
        "declaration-property-value-allowed-list": null,
        "rule-selector-property-disallowed-list": null,
        "rrnnm/space-token-scale": true,
      },
    },
    // 置き場所とレイヤーの対応（ADR-0025「レイヤーは5つにし、pages を最後の手段にする」）。
    {
      files: ["src/styles/layers.css"],
      rules: { "rrnnm/layer-by-path": layerBy({ order: true }) },
    },
    {
      files: ["src/styles/tokens.css", "src/styles/fonts.css", "src/styles/font-fallback.css"],
      rules: { "rrnnm/layer-by-path": layerBy({ outside: true }) },
    },
    {
      files: ["src/styles/global.css"],
      rules: { "rrnnm/layer-by-path": layerBy({ layers: ["base", "layout", "utilities"] }) },
    },
    {
      files: ["src/styles/subpage.css", "src/layouts/**/*.astro"],
      rules: { "rrnnm/layer-by-path": layerBy({ layers: ["layout"] }) },
    },
    {
      files: [
        "src/components/**/*.module.css",
        "src/components/**/*.astro",
        "src/unreleased/_parts/**/*.{module.css,astro}",
      ],
      rules: { "rrnnm/layer-by-path": layerBy({ layers: ["components"] }) },
    },
    {
      // src/unreleased/ でルートになるのは、`_` で始まるディレクトリの外の .astro（ADR-0018）。
      files: ["src/pages/**/*.astro", "src/unreleased/*.astro", "src/unreleased/!(_*)/**/*.astro"],
      rules: {
        "rrnnm/layer-by-path": layerBy({ layers: ["pages"] }),
        "rrnnm/page-global-selector": true,
        "rrnnm/page-places-components": true,
      },
    },
    {
      files: ["src/unreleased/**"],
      rules: Object.fromEntries(Object.keys(valueRules).map((rule) => [rule, null])),
    },
  ],
};
