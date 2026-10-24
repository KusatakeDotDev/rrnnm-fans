import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "vite-plus/test/browser-playwright";
import { defineConfig } from "vite-plus";

// コンポーネントのテストの層（Issue rurino-nemo-fansite#100）。story を1つずつ Chromium で描き、addon-a11y の axe を回す。
// 単体テスト（vitest.config.ts）とは設定を分ける。あちらは Node で動き、Stryker もそれを読む
// （vitest.stryker.config.ts）ので、ブラウザーのプロジェクトを混ぜるとミューテーションテストまで
// Chromium を立てることになる。
// 検査の範囲・除外は .storybook/preview.ts の parameters.a11y が持つ。
export default defineConfig({
  plugins: [storybookTest({ configDir: ".storybook" })],
  test: {
    name: "storybook",
    browser: {
      enabled: true,
      headless: true,
      // 落ちたときのスクリーンショットは撮られない。browser.screenshotFailures を書かないと、storybookTest が false にする。
      // 動きを減らす設定で描く。axe は描いた直後に回るので、登場のアニメーションの途中
      // （畑の見出しの copy-in は opacity 0 から）を検査すると、結果がそのときの描画次第になる。
      // この設定だとアニメーションが止まり、出きった姿で毎回同じように検査される。
      // ただし畑の見出しは地がグラデーションなので、axe は比を出せず判定を保留する（incomplete で、落ちない）。
      // これはサイトの規約テスト（tests/conformance/routes.spec.ts）の axe でも同じ。
      provider: playwright({ contextOptions: { reducedMotion: "reduce" } }),
      // 幅はここで決めても効かない。addon-vitest が story ごとに 1200×900 に設定し直す（story に parameters.viewport が無いとき）。
      // 規約テストの axe（1280×720）と同じく、広い画面のレイアウトを見ることになる。
      // テーマはライトだけ。tokens.css にまだダークが無いため。
      // TODO(RRNNM-28): ダークを入れたら、ここにダークの instance を足す。
      instances: [{ browser: "chromium" }],
    },
  },
});
