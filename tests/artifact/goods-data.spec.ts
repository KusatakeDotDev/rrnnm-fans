import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { DIST, distTextFiles } from "../helpers/dist";

import { BOOTH_GOODS } from "../../src/data/goods";

const showUnreleased = (): boolean =>
  JSON.parse(readFileSync(`${DIST}.receipt.json`, "utf8")).showUnreleased;

test("オフのビルドには、グッズの商品と画像、グッズの CSS が漏れない", () => {
  test.skip(showUnreleased() === true, "未公開ONのビルド");
  expect(showUnreleased()).toBe(false);
  for (const { rel, text } of distTextFiles()) {
    expect(text, rel).not.toContain("pximg.net");
    expect(text, rel).not.toContain("rurino-nemo.booth.pm/items/");
    expect(text, rel).not.toMatch(/\.goods\.astro-|class="goods[\s"]/);
    for (const item of BOOTH_GOODS) expect(text, rel).not.toContain(item.name);
  }
});
