import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { SKEB_WORKS } from "../../src/data/skeb";
import { DIST, distTextFiles } from "../helpers/dist";

test("Skeb — 本番OFFでは作品データと専用カードCSS・スクリプトを成果物に含めない", () => {
  const receipt = JSON.parse(readFileSync(`${DIST}.receipt.json`, "utf8"));
  test.skip(receipt.showUnreleased === true, "未公開ONのビルド");
  expect(receipt.showUnreleased).toBe(false);
  // 見るのは納品のポストだけ。ご本人のほかのポスト（src/pages/kusobaka-slot.astro の元ネタ）へのリンクは、Skeb と関係なく出してよい。
  const deliveryIds = SKEB_WORKS.flatMap((work) =>
    work.deliveryPost
      ? [work.deliveryPost.url.slice(work.deliveryPost.url.lastIndexOf("/") + 1)]
      : [],
  );
  expect(deliveryIds.length, "納品のポストが0件。検査が空振りしている").toBeGreaterThan(0);
  for (const { rel, text } of distTextFiles()) {
    expect(text, rel).not.toContain("skeb.jp/@rurino_nemo/works/");
    expect(
      deliveryIds.filter((id) => text.includes(id)),
      rel,
    ).toEqual([]);
    expect(text, rel).not.toMatch(/_works_[a-z0-9]+_\d+/);
    expect(text, rel).not.toContain("data-skeb-");
  }
});
