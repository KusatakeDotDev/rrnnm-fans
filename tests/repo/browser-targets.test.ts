import { describe, expect, it } from "vite-plus/test";

import storybookConfig from "../../.storybook/main";
import astroConfig from "../../astro.config.mjs";
import { cssTarget } from "../../src/styles/browser-targets.mjs";

/**
 * サイトと Storybook が、同じブラウザの下限で CSS を minify するかを見る
 * （ADR-0025「ブラウザの下限は1か所に書き、サイトと Storybook に同じ値を渡す」）。
 * Storybook の出力は同期のスクリーンショット比較の正解になるので、下限がずれると、サイトと違う CSS を正解にする。
 * 値を写した配列でも通らないよう、browser-targets.mjs の配列そのものかを `toBe` で見る。
 */
describe("ブラウザの下限は browser-targets.mjs の1か所にある", () => {
  it("サイトは、その下限で CSS を minify する", () => {
    expect(astroConfig.vite?.build?.cssTarget).toBe(cssTarget);
  });

  it("Storybook も、その下限で CSS を minify する", async () => {
    const vite = await storybookConfig.viteFinal?.({}, {} as never);
    expect(vite?.build?.cssTarget).toBe(cssTarget);
  });
});
