import { expect, test } from "@playwright/test";

import {
  CHAIN_COUNT,
  CHAIN_INTERVAL_MS,
  ROUND_MS,
  SPAWN_INTERVAL_MS,
  watchUrl,
} from "../../src/lib/alt-f4";
import { VIDEO_IDS } from "../../src/unreleased/play/_alt-f4/videos";
import { builtRoutes } from "../helpers/dist";

/**
 * src/unreleased/play/alt-f4.astro。スタートで広告のウィンドウが開き、× で閉じた数を数え、広告を押すと動画の視聴ページを
 * 小さな別のウィンドウで開き、ウィンドウの外を押すともう1枚開き、時間切れで結果を出して × が効かなくなる。
 * 位置・連鎖・残り時間の計算は tests/unit/alt-f4.test.ts が見るので、ここでは乱数を 0 に留め、時計を進めて、つなぎを見る。
 */

const ROUTE = "/play/alt-f4/";
const hasPage = builtRoutes().includes(ROUTE);
const IMAGE = "https://i.ytimg.com/vi/fixture/hqdefault.jpg";

test("広告のウィンドウを閉じて数え、時間切れで止まる", async ({ page }) => {
  test.skip(!hasPage, "本番モードではページを生成しない");

  await page.route("https://www.youtube.com/oembed?**", (route) => {
    const video = new URL(new URL(route.request().url()).searchParams.get("url")!).searchParams.get(
      "v",
    );
    return route.fulfill({
      json: {
        title: `固定の題名 ${video}`,
        provider_name: "YouTube",
        thumbnail_width: 480,
        thumbnail_height: 360,
        thumbnail_url: IMAGE,
      },
    });
  });
  await page.route("https://i.ytimg.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"/>',
    }),
  );
  await page.addInitScript(() => {
    Math.random = () => 0;
    const opened: unknown[][] = [];
    (window as unknown as { opened: unknown[][] }).opened = opened;
    window.open = (...args: unknown[]) => {
      opened.push(args);
      return null;
    };
  });
  // 時計は止めて、runFor で進めた分だけ進める。流れたままだと、手順のあいだに次の1枚が開いて、数がずれる。
  await page.clock.install({ time: new Date("2026-10-25T00:00:00Z") });
  await page.goto(ROUTE);
  await page.clock.pauseAt(new Date("2026-10-25T00:00:10Z"));

  const start = page.locator("[data-altf4-start]");
  const popups = page.locator("[data-altf4-popup]");
  const score = page.locator("[data-altf4-score]");
  const result = page.locator("[data-altf4-result]");

  await expect(start).toBeEnabled();
  await start.click();

  await test.step("スタートで1枚開き、広告は選んだ動画のどれかの視聴ページを指す", async () => {
    await expect(popups).toHaveCount(1);
    const ad = popups.locator("[data-altf4-ad]");
    const href = await ad.getAttribute("href");
    expect(VIDEO_IDS.map(watchUrl)).toContain(href);
    await expect(ad.locator("img")).toHaveAttribute("src", IMAGE);
  });

  await test.step("× で閉じると、閉じた数が増える", async () => {
    await popups.locator("[data-altf4-close]").click();
    await expect(popups).toHaveCount(0);
    await expect(score).toHaveText("1");
  });

  await test.step("ウィンドウの外を押すと、もう1枚開く", async () => {
    // 角はデスクトップの角丸で切り抜かれていて押せないので、まん中（ウィンドウを全部閉じたあとで空いている）を押す。
    await page.locator("[data-altf4-popups]").click();
    await expect(popups).toHaveCount(1);
    await expect(score).toHaveText("1");
  });

  await test.step("広告を押すと、視聴ページを小さな別のウィンドウで開き、ページは移らない", async () => {
    const ad = popups.locator("[data-altf4-ad]");
    const href = await ad.getAttribute("href");
    await ad.click();
    expect(
      await page.evaluate(() => (window as unknown as { opened: unknown[][] }).opened),
    ).toEqual([[href, "_blank", "popup,noopener,noreferrer"]]);
    expect(new URL(page.url()).pathname).toBe(ROUTE);
  });

  await test.step("乱数が当たると、連鎖で続けて開く", async () => {
    await page.clock.runFor(SPAWN_INTERVAL_MS + CHAIN_COUNT * CHAIN_INTERVAL_MS);
    await expect(popups).toHaveCount(1 + CHAIN_COUNT);
  });

  await test.step("時間切れで結果を出し、× が効かなくなる", async () => {
    await page.clock.runFor(ROUND_MS);
    await expect(result).toBeVisible();
    await expect(result.locator("[data-altf4-result-count]")).toHaveText("1");
    const count = await popups.count();
    // 結果の枠が上に重なって押せないことがあるので、× に直接押したことにする。
    await popups.last().locator("[data-altf4-close]").dispatchEvent("click");
    await expect(popups).toHaveCount(count);
    await expect(score).toHaveText("1");
    await expect(start).toBeEnabled();
  });

  await test.step("もう一回で、ウィンドウと数を戻して始め直す", async () => {
    await start.click();
    await expect(result).toBeHidden();
    await expect(popups).toHaveCount(1);
    await expect(score).toHaveText("0");
  });
});
