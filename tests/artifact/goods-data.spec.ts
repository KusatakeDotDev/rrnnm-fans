import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { DIST, distTextFiles } from "../helpers/dist";

import { BOOTH_GOODS } from "../../src/data/goods";

/** 運営方針の BOOTH の画像の箇条（src/unreleased/_parts/BoothImagePolicy.astro）に付けたマーカー。 */
const POLICY_MARKER = "data-booth-image-policy";

const showUnreleased = (): boolean =>
  JSON.parse(readFileSync(`${DIST}.receipt.json`, "utf8")).showUnreleased;

test("オフのビルドには、グッズの商品と画像、運営方針の BOOTH の画像の箇条、グッズの CSS が漏れない", () => {
  test.skip(showUnreleased() === true, "未公開ONのビルド");
  expect(showUnreleased()).toBe(false);
  for (const { rel, text } of distTextFiles()) {
    expect(text, rel).not.toContain("pximg.net");
    expect(text, rel).not.toContain("rurino-nemo.booth.pm/items/");
    expect(text, rel).not.toContain(POLICY_MARKER);
    expect(text, rel).not.toMatch(/\.goods\.astro-|class="goods[\s"]/);
    for (const item of BOOTH_GOODS) expect(text, rel).not.toContain(item.name);
  }
});

test("オンのビルドの運営方針には、BOOTH の画像の箇条が、漏れを探すマーカー付きで出る", () => {
  test.skip(showUnreleased() === false, "未公開OFFのビルド");
  const about = distTextFiles().find(({ rel }) => rel === "about/index.html");
  expect(about?.text).toContain(POLICY_MARKER);
});
