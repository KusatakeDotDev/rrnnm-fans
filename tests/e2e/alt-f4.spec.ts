import { expect, test } from "@playwright/test";

import {
  adWindowFeatures,
  BGM_LEVEL,
  bgmGain,
  CHAIN_COUNT,
  CHAIN_INTERVAL_MS,
  openingReopenDelay,
  ROUND_MS,
  SPAWN_INTERVAL_MS,
  VIDEOS_PATH,
  VIDEOS_PER_ROUND,
  watchUrl,
} from "../../src/lib/alt-f4";
import { OPENING_VIDEO_ID } from "../../src/unreleased/play/_alt-f4/opening";
import { builtRoutes } from "../helpers/dist";

/**
 * src/unreleased/play/alt-f4.astro。妖精の吹き出しかタスクバーのスタートで始めると配信のウィンドウが開き、× で閉じた数を数え、
 * ウィンドウの外を押すと10枚続けて開き、配信を押すと動画の視聴ページを小さな別のウィンドウで開いてその回を終える。終えたときも
 * 時間切れのときも、妖精が記録を伝えてもう一回やるかを尋ね、× が効かなくなる。配信のウィンドウに出す動画は、一覧から回ごとに
 * 選び直す。始める前は、記念配信のウィンドウを1枚、まん中に置き、× で閉じると、少しして画像だけを大きくして開き直す。
 * BGM は、デスクトップの外のボタンで鳴らし・止め、スライダーで大きさを変える。
 * 位置・連鎖・残り時間・動画の選び方、視聴ページのウィンドウの大きさと位置、始める前の1枚を開き直すまでの時間と幅の計算は
 * tests/unit/alt-f4.test.ts が見るので、ここでは乱数を 0 に留め（何度選んでも同じ動画になる）、時計を進めて、つなぎを見る。
 */

const ROUTE = "/play/alt-f4/";
const hasPage = builtRoutes().includes(ROUTE);
/** 動画ごとに別の URL にする。同じ URL だと、ブラウザは2本目からキャッシュを使い、取りに行った数で待てない。 */
const imageOf = (video: string) => `https://i.ytimg.com/vi/${video}/hqdefault.jpg`;
/** Worker が返す一覧の代わり。1回に出す数より多くして、そこから選ぶことを見る。 */
const VIDEO_IDS = Array.from(
  { length: VIDEOS_PER_ROUND + 5 },
  (_, n) => `fixture${String(n + 1).padStart(4, "0")}`,
);

test("配信のウィンドウを閉じて数え、時間切れで止まる", async ({ page }) => {
  test.skip(!hasPage, "本番モードではページを生成しない");

  await page.route(`**${VIDEOS_PATH}`, (route) => route.fulfill({ json: VIDEO_IDS }));
  let oembeds = 0;
  await page.route("https://www.youtube.com/oembed?**", (route) => {
    oembeds++;
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
  // BGM の曲（重ねていなければ無音の mp3）。ページにほかの音は無い。
  let tracks = 0;
  page.on("request", (request) => {
    if (/\/_astro\/[^/]+\.(?:m4a|mp3)$/.test(request.url())) tracks++;
  });
  await page.addInitScript(() => {
    Math.random = () => 0;
    const opened: unknown[][] = [];
    (window as unknown as { opened: unknown[][] }).opened = opened;
    window.open = (...args: unknown[]) => {
      opened.push(args);
      return null;
    };
    const gains: GainNode[] = [];
    (window as unknown as { gains: GainNode[] }).gains = gains;
    // oxlint-disable-next-line typescript/unbound-method -- 差し替える前のものを取っておき、call で this を渡して呼ぶ
    const createGain = BaseAudioContext.prototype.createGain;
    BaseAudioContext.prototype.createGain = function (this: BaseAudioContext) {
      const gain = createGain.call(this);
      gains.push(gain);
      return gain;
    };
  });
  const start = page.locator("[data-altf4-start]");
  const popups = page.locator("[data-altf4-popup]");
  const assistant = page.locator("[data-altf4-assistant]");
  const balloon = page.locator("[data-altf4-balloon]");
  const yes = page.locator("[data-altf4-yes]");
  const message = page.locator("[data-altf4-message]");

  await page.clock.install({ time: new Date("2026-10-25T00:00:00Z") });
  await page.goto(ROUTE);
  // サムネイルは取れたものからウィンドウに出るので、全部を取り終えてから始める。時計を止める前に待つのは、止めるときに進める10秒で、
  // 取っている途中の fetch の AbortSignal.timeout（Playwright の時計に従う）が切れ、取れる数が減るため（PR #18 の CI）。
  // 1回めの回の分と、始める前に置く1枚の分。
  await expect.poll(() => images).toBe(VIDEOS_PER_ROUND + 1);
  await expect(start).toBeEnabled();
  // 一覧の全部ではなく、1回に出す数だけを取る。
  expect(oembeds).toBe(VIDEOS_PER_ROUND + 1);
  // 時計は止めて、runFor で進めた分だけ進める。流れたままだと、手順のあいだに次の1枚が開いて、数がずれる。
  await page.clock.pauseAt(new Date("2026-10-25T00:00:10Z"));

  /** 始める前の1枚を、記念配信を指して、デスクトップのまん中に置いていること。 */
  const expectOpeningCentered = async () => {
    await expect(popups).toHaveCount(1);
    await expect(popups.locator("[data-altf4-ad]")).toHaveAttribute(
      "href",
      watchUrl(OPENING_VIDEO_ID),
    );
    const desktopBox = (await page.locator("[data-altf4-popups]").boundingBox())!;
    const popupBox = (await popups.boundingBox())!;
    // 位置は整数の px にそろえるので、1 px までずれる。
    expect(
      Math.abs(popupBox.x - desktopBox.x - (desktopBox.width - popupBox.width) / 2),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(popupBox.y - desktopBox.y - (desktopBox.height - popupBox.height) / 2),
    ).toBeLessThanOrEqual(1);
  };
  /** 始める前の1枚の、ウィンドウ・画像・× の大きさと、題名の字の大きさ。 */
  const measureOpening = async () => ({
    popup: (await popups.boundingBox())!,
    image: (await popups.locator("[data-altf4-image]").boundingBox())!,
    close: (await popups.locator("[data-altf4-close]").boundingBox())!,
    captionFont: await popups
      .locator("[data-altf4-caption]")
      .evaluate((caption) => getComputedStyle(caption).fontSize),
  });

  /** 始める前の1枚の、開き直す前の幅。遊び始めて開くウィンドウと同じ大きさから始める。 */
  let openingFirstWidth = 0;
  await test.step("始める前は、記念配信のウィンドウを1枚、デスクトップのまん中に置く", async () => {
    await expectOpeningCentered();
    openingFirstWidth = (await popups.boundingBox())!.width;
  });

  await test.step("始める前の1枚は × で閉じられ、少しして、画像だけを大きくしてまん中に開き直す。閉じるたびに早く開き直す", async () => {
    let previous = await measureOpening();
    for (const closedTimes of [0, 1]) {
      await popups.locator("[data-altf4-close]").click();
      await expect(popups).toHaveCount(0);
      await page.clock.runFor(openingReopenDelay(closedTimes) - 1);
      await expect(popups).toHaveCount(0);
      await page.clock.runFor(1);
      await expectOpeningCentered();
      const current = await measureOpening();
      expect(current.popup.width).toBeGreaterThan(previous.popup.width);
      expect(current.image.width).toBeGreaterThan(previous.image.width);
      expect(current.close.width).toBe(previous.close.width);
      expect(current.close.height).toBe(previous.close.height);
      expect(current.captionFont).toBe(previous.captionFont);
      previous = current;
    }
  });

  await test.step("妖精が吹き出しで始めるかを尋ね、「いいえ」で閉じても、妖精を押せば尋ね直す", async () => {
    await expect(yes).toBeVisible();
    await page.locator("[data-altf4-no]").click();
    await expect(balloon).toBeHidden();
    await page.locator("[data-altf4-fairy]").click();
    await expect(yes).toBeVisible();
  });

  await test.step("BGM は押すまで曲を取らず、押すと鳴り、つまみで大きさを変えて覚え、もう一度押すと止まる。押してもウィンドウは開かない", async () => {
    const toggle = page.locator("[data-altf4-bgm-toggle]");
    const volume = page.locator("[data-altf4-bgm-volume]");
    const audio = page.locator("[data-altf4-bgm] audio");
    const gain = () =>
      page.evaluate(() => (window as unknown as { gains: GainNode[] }).gains[0]?.gain.value);
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(volume).toHaveValue(String(BGM_LEVEL));
    expect(tracks).toBe(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => audio.evaluate((el: HTMLAudioElement) => !el.paused && el.readyState >= 3))
      .toBe(true);
    expect(tracks).toBeGreaterThan(0);
    expect(await gain()).toBeCloseTo(bgmGain(BGM_LEVEL), 5);

    await volume.fill("80");
    expect(await gain()).toBeCloseTo(bgmGain(80), 5);
    expect(await page.evaluate(() => localStorage.getItem("alt-f4-bgm-level"))).toBe("80");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(await audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true);
    await expect(popups).toHaveCount(1);
  });

  await yes.click();

  await test.step("遊び始めると、もう一回で出す動画を選び直して取り始める", async () => {
    await expect.poll(() => oembeds).toBe(2 * VIDEOS_PER_ROUND + 1);
  });

  await test.step("妖精の「はい」で1枚開いて妖精は隠れ、配信は選んだ動画のどれかの視聴ページを指す。大きさは、始める前の1枚の最初と同じ", async () => {
    await expect(popups).toHaveCount(1);
    await expect(assistant).toBeHidden();
    // 始める前の1枚は、幅を整数の px にそろえるので、1 px までずれる。
    expect(Math.abs((await popups.boundingBox())!.width - openingFirstWidth)).toBeLessThanOrEqual(
      1,
    );
    const ad = popups.locator("[data-altf4-ad]");
    const href = await ad.getAttribute("href");
    expect(VIDEO_IDS.map(watchUrl)).toContain(href);
    await expect(ad.locator("img")).toHaveAttribute(
      "src",
      imageOf(new URL(href!).searchParams.get("v")!),
    );
  });

  await test.step("× で閉じる", async () => {
    await popups.locator("[data-altf4-close]").click();
    await expect(popups).toHaveCount(0);
  });

  await test.step("ウィンドウの外を押すと、10枚続けて開く", async () => {
    // 角はデスクトップの角丸で切り抜かれていて押せないので、まん中（ウィンドウを全部閉じたあとで空いている）を押す。
    await page.locator("[data-altf4-popups]").click();
    // 開き終えるまでは SPAWN_INTERVAL_MS より短いので、ふだんの1枚は混ざらない。
    await page.clock.runFor(CHAIN_COUNT * CHAIN_INTERVAL_MS);
    await expect(popups).toHaveCount(CHAIN_COUNT);
  });

  await test.step("配信を押すと、視聴ページを画面の右下に小さな別のウィンドウで開き、ページは移らず、その回はそこで終わる", async () => {
    const ad = popups.last().locator("[data-altf4-ad]");
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
    // 時間切れを待たずに、それまでに閉じた数を記録として伝え、もうウィンドウを開かない。
    await expect(yes).toBeVisible();
    await expect(message).toContainText("記録: 1");
    await expect(start).toBeEnabled();
    await page.clock.runFor(SPAWN_INTERVAL_MS);
    await expect(popups).toHaveCount(CHAIN_COUNT);
  });

  await test.step("タスクバーのスタートからも、ウィンドウを戻して始め直せる", async () => {
    await start.click();
    await expect(assistant).toBeHidden();
    await expect(popups).toHaveCount(1);
  });

  await test.step("乱数が当たると、連鎖で続けて開く", async () => {
    await page.clock.runFor(SPAWN_INTERVAL_MS + CHAIN_COUNT * CHAIN_INTERVAL_MS);
    await expect(popups).toHaveCount(1 + CHAIN_COUNT);
  });

  await test.step("時間切れで妖精が閉じた数を記録として伝え、もう一回やるかを尋ね、× が効かなくなる", async () => {
    await popups.last().locator("[data-altf4-close]").click();
    await page.clock.runFor(ROUND_MS);
    await expect(yes).toBeVisible();
    await expect(message).toContainText("記録: 1");
    const count = await popups.count();
    // 妖精の吹き出しが上に重なって押せないことがあるので、× に直接押したことにする。
    await popups.last().locator("[data-altf4-close]").dispatchEvent("click");
    await expect(popups).toHaveCount(count);
    await expect(message).toContainText("記録: 1");
    await expect(start).toBeEnabled();
  });
});
