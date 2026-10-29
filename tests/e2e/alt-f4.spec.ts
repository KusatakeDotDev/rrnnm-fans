import { expect, test } from "@playwright/test";

import {
  adWindowFeatures,
  CHAIN_COUNT,
  CHAIN_INTERVAL_MS,
  ROUND_MS,
  SPAWN_INTERVAL_MS,
  VIDEOS_PATH,
  watchUrl,
} from "../../src/lib/alt-f4";
import { builtRoutes } from "../helpers/dist";

/**
 * src/unreleased/play/alt-f4.astro。妖精の吹き出しかタスクバーのスタートで始めると広告のウィンドウが開き、× で閉じた数を数え、
 * 広告を押すと動画の視聴ページを小さな別のウィンドウで開き、ウィンドウの外を押すともう1枚開き、時間切れで妖精がもう一回やるかを
 * 尋ねて × が効かなくなる。
 * 位置・連鎖・残り時間と、視聴ページのウィンドウの大きさと位置の計算は tests/unit/alt-f4.test.ts が見るので、ここでは乱数を 0 に留め、時計を進めて、つなぎを見る。
 */

const ROUTE = "/play/alt-f4/";
const hasPage = builtRoutes().includes(ROUTE);
/** 動画ごとに別の URL にする。同じ URL だと、ブラウザは2本目からキャッシュを使い、取りに行った数で待てない。 */
const imageOf = (video: string) => `https://i.ytimg.com/vi/${video}/hqdefault.jpg`;
/** Worker が中継するチャンネルの最新の動画の代わり（テストの Worker は、YouTube へ出ない。playwright.config.ts）。 */
const VIDEO_IDS = ["fixture0001", "fixture0002", "fixture0003"];

test("広告のウィンドウを閉じて数え、時間切れで止まる", async ({ page }) => {
  test.skip(!hasPage, "本番モードではページを生成しない");

  await page.route(`**${VIDEOS_PATH}`, (route) => route.fulfill({ json: VIDEO_IDS }));
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
        thumbnail_url: imageOf(video!),
      },
    });
  });
  let images = 0;
  await page.route("https://i.ytimg.com/**", (route) => {
    images++;
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"/>',
    });
  });
  await page.addInitScript(() => {
    Math.random = () => 0;
    const opened: unknown[][] = [];
    (window as unknown as { opened: unknown[][] }).opened = opened;
    window.open = (...args: unknown[]) => {
      opened.push(args);
      return null;
    };
  });
  const start = page.locator("[data-altf4-start]");
  const popups = page.locator("[data-altf4-popup]");
  const score = page.locator("[data-altf4-score]");
  const assistant = page.locator("[data-altf4-assistant]");
  const balloon = page.locator("[data-altf4-balloon]");
  const yes = page.locator("[data-altf4-yes]");

  await page.clock.install({ time: new Date("2026-10-25T00:00:00Z") });
  await page.goto(ROUTE);
  // サムネイルは取れたものから広告に出るので、全部を取り終えてから始める。時計を止める前に待つのは、止めるときに進める10秒で、
  // 取っている途中の fetch の AbortSignal.timeout（Playwright の時計に従う）が切れ、取れる数が減るため（PR #18 の CI）。
  await expect.poll(() => images).toBe(VIDEO_IDS.length);
  await expect(start).toBeEnabled();
  // 時計は止めて、runFor で進めた分だけ進める。流れたままだと、手順のあいだに次の1枚が開いて、数がずれる。
  await page.clock.pauseAt(new Date("2026-10-25T00:00:10Z"));

  await test.step("妖精が吹き出しで始めるかを尋ね、「いいえ」で閉じても、妖精を押せば尋ね直す", async () => {
    await expect(yes).toBeVisible();
    await page.locator("[data-altf4-no]").click();
    await expect(balloon).toBeHidden();
    await page.locator("[data-altf4-fairy]").click();
    await expect(yes).toBeVisible();
  });

  await yes.click();

  await test.step("妖精の「はい」で1枚開いて妖精は隠れ、広告は選んだ動画のどれかの視聴ページを指す", async () => {
    await expect(popups).toHaveCount(1);
    await expect(assistant).toBeHidden();
    const ad = popups.locator("[data-altf4-ad]");
    const href = await ad.getAttribute("href");
    expect(VIDEO_IDS.map(watchUrl)).toContain(href);
    await expect(ad.locator("img")).toHaveAttribute(
      "src",
      imageOf(new URL(href!).searchParams.get("v")!),
    );
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

  await test.step("広告を押すと、視聴ページを画面の右下に小さな別のウィンドウで開き、ページは移らない", async () => {
    const ad = popups.locator("[data-altf4-ad]");
    const href = await ad.getAttribute("href");
    const area = await page.evaluate(() => {
      const s = screen as Screen & { availLeft: number; availTop: number };
      return { left: s.availLeft, top: s.availTop, width: s.availWidth, height: s.availHeight };
    });
    await ad.click();
    expect(
      await page.evaluate(() => (window as unknown as { opened: unknown[][] }).opened),
    ).toEqual([[href, "_blank", adWindowFeatures(area)]]);
    expect(new URL(page.url()).pathname).toBe(ROUTE);
  });

  await test.step("乱数が当たると、連鎖で続けて開く", async () => {
    await page.clock.runFor(SPAWN_INTERVAL_MS + CHAIN_COUNT * CHAIN_INTERVAL_MS);
    await expect(popups).toHaveCount(1 + CHAIN_COUNT);
  });

  await test.step("時間切れで妖精がもう一回やるかを尋ね、× が効かなくなる", async () => {
    await page.clock.runFor(ROUND_MS);
    await expect(yes).toBeVisible();
    const count = await popups.count();
    // 妖精の吹き出しが上に重なって押せないことがあるので、× に直接押したことにする。
    await popups.last().locator("[data-altf4-close]").dispatchEvent("click");
    await expect(popups).toHaveCount(count);
    await expect(score).toHaveText("1");
    await expect(start).toBeEnabled();
  });

  await test.step("タスクバーのスタートからも、ウィンドウと数を戻して始め直せる", async () => {
    await start.click();
    await expect(assistant).toBeHidden();
    await expect(popups).toHaveCount(1);
    await expect(score).toHaveText("0");
  });
});
