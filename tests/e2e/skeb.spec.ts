import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { AXE_TAGS, THIRD_PARTY_EMBED } from "../helpers/axe";
import { builtRoutes } from "../helpers/dist";
import { OFFICIAL } from "../../src/data/official";
import rawData from "../../src/data/skeb-summaries.json" with { type: "json" };
import { SKEB_WORKS, type SkebWork } from "../../src/data/skeb";
import { dailyIndex, sharedTags } from "../../src/lib/skeb-browse";
import { validateSummaryData } from "../../src/lib/skeb-summary";
const data = validateSummaryData(
  rawData,
  SKEB_WORKS.map((work) => work.url),
);
const hasSkeb = builtRoutes().includes("/skeb/");
const summaryOf = (work: SkebWork) => data.works.find((record) => record.url === work.url)?.summary;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hrefsOf = (work: SkebWork) =>
  [work.deliveryPost?.url, work.youtube, work.url].flatMap((href) => (href ? [href] : []));

/** evaluateAll の中ではアクセシブルな名前を計算できないので、ariaSnapshot のリンクの行から URL ごとに取り出す。 */
const linkNames = (snapshot: string) =>
  new Map(
    [...snapshot.matchAll(/- '?link "((?:[^"\\]|\\.)*)"'?:\n\s+- \/url: (\S+)/g)].map(
      ([, name, url]) => [url!, JSON.parse(`"${name}"`) as string],
    ),
  );

const overflowing = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const wide = (element: Element) => element.scrollWidth > element.clientWidth;
    return [
      ...(wide(document.documentElement) ? ["page"] : []),
      ...[...document.querySelectorAll<HTMLElement>("[data-skeb-list] > li")]
        .filter(wide)
        .map((card) => `#${card.dataset["skebWork"]}`),
    ];
  });

/** 127.0.0.1 の外への通信を止め、止めた URL を集める。 */
const blockExternal = async (page: Page) => {
  const externalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") {
      externalRequests.push(url.href);
      await route.abort();
    } else {
      await route.continue();
    }
  });
  return externalRequests;
};

test("Skeb — JS が無くても、全作品のカードとリンクを読め、狭い幅でも広い幅でも横にはみ出さない", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 360, height: 800 },
  });
  try {
    const page = await context.newPage();
    const externalRequests = await blockExternal(page);
    if (!hasSkeb) {
      expect((await page.goto("/skeb/"))?.status()).toBe(404);
      return;
    }
    await page.goto("/skeb/");
    const main = page.getByRole("main");

    await test.step("プロフィールへのリンクを出し、画像や埋め込みは置かない", async () => {
      const profile = main.locator(`a[href="${OFFICIAL.skeb}"]`);
      await expect(profile).toBeVisible();
      await expect(profile).toHaveAttribute("rel", "noopener noreferrer");
      await expect(main.locator("img, iframe, video, audio, object, embed")).toHaveCount(0);
    });

    // ピックアップ・並べ替え・絞り込みは JS の上乗せ。JS が無ければ、押しても何も起きない操作を出さない。
    await test.step("押しても動かない操作と、検索を出さない", async () => {
      await expect(main.locator("[data-skeb-pickup]")).toBeHidden();
      await expect(main.getByRole("button")).toHaveCount(0);
      await expect(main.getByRole("combobox")).toHaveCount(0);
      await expect(main.getByRole("searchbox")).toHaveCount(0);
    });

    await test.step("17件とも番号順に、リンク・セリフ・お題・タグを見える形で出す", async () => {
      const list = main.locator("[data-skeb-list]");
      const cards = await list.locator("> li").evaluateAll((items) =>
        items.map((card) => {
          const shown = (element: Element) =>
            element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
          const texts = (selector: string) =>
            [...card.querySelectorAll(selector)]
              .filter(shown)
              .map((element) => element.textContent);
          const quote = card.querySelector("blockquote");
          return {
            title: texts("h3"),
            links: [...card.querySelectorAll("a")].map((link) => ({
              href: link.getAttribute("href"),
              target: link.getAttribute("target"),
              rel: link.getAttribute("rel"),
              shown: shown(link),
            })),
            quote: quote && {
              text: quote.textContent,
              elements: quote.childElementCount,
              cite: quote.getAttribute("cite"),
              shown: shown(quote),
            },
            paragraphs: texts("p"),
            tags: texts("[data-skeb-tag]"),
          };
        }),
      );
      expect(cards).toEqual(
        SKEB_WORKS.map((work) => {
          const summary = summaryOf(work);
          return {
            title: [work.title],
            links: hrefsOf(work).map((href) => ({
              href,
              target: "_blank",
              rel: "noopener noreferrer",
              shown: true,
            })),
            quote: summary
              ? {
                  text: summary.quote.text,
                  elements: 0,
                  cite: summary.quote.provenance === "user-provided" ? null : summary.quote.url,
                  shown: true,
                }
              : null,
            // 一部の音声の紹介である旨の行は文言なので、行があることだけを見る。
            paragraphs: summary
              ? [...(work.summaryScope ? [expect.any(String)] : []), summary.heading]
              : [],
            tags: summary?.tags ?? [],
          };
        }),
      );
      // 同じ文字のリンクが17件並ぶので、読み上げでも作品を聞き分けられるよう、名前に作品の名前を入れる。
      const names = linkNames(await list.ariaSnapshot());
      expect([...names.keys()]).toEqual(SKEB_WORKS.flatMap(hrefsOf));
      for (const work of SKEB_WORKS) {
        for (const href of hrefsOf(work))
          expect(names.get(href), href).toMatch(new RegExp(`${escapeRegExp(work.title)}(?!\\d)`));
      }
    });

    for (const width of [360, 1280]) {
      await test.step(`${width}px で、ページもカードも横にはみ出さない`, async () => {
        await page.setViewportSize({ width, height: 800 });
        expect(await overflowing(page)).toEqual([]);
      });
    }
    expect(externalRequests).toEqual([]);
  } finally {
    await context.close();
  }
});

test("Skeb — JS があっても開いただけでは外へ通信せず、axe のどのルールにも当たらない", async ({
  page,
}) => {
  test.skip(!hasSkeb, "本番モードではページを生成しない");
  const externalRequests = await blockExternal(page);
  await page.goto("/skeb/", { waitUntil: "networkidle" });
  expect(externalRequests).toEqual([]);
  // AXE_TAGS で絞らずに全ルールを回すのは、ADR-0027「Skeb のページは、カードの中身を1つの幅で見る」の決定。
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" / ")}`),
  ).toEqual([]);
});

test("Skeb — JS があれば、日替わりのピックアップ・並べ替え・タグの絞り込みを使える", async ({
  page,
}) => {
  test.skip(!hasSkeb, "本番モードではページを生成しない");
  await blockExternal(page);
  // 日本時間 2026-10-14 の昼。ピックアップは日本時間の日付で決まる。
  await page.clock.setFixedTime(new Date("2026-10-14T03:00:00Z"));
  await page.goto("/skeb/");
  const main = page.getByRole("main");
  const list = main
    .getByRole("list")
    .filter({ has: page.getByRole("heading", { level: 3 }) })
    .first();
  const titles = list.locator("> li").getByRole("heading", { level: 3 });

  const approved = data.works.flatMap((work, index) => (work.summary ? [index + 1] : []));
  const pickup = main.locator("[data-skeb-pickup]");
  await expect(pickup).toBeVisible();
  await expect(pickup.locator("[data-skeb-pickup-note]")).toContainText("2026.10.14");
  const todays = `ボイス作品 #${approved[dailyIndex("2026-10-14", approved.length)]}`;
  await expect(pickup.getByRole("heading", { level: 3 })).toHaveText(todays);

  await pickup.getByRole("button", { name: "別の作品を引く" }).click();
  await expect(pickup.getByRole("heading", { level: 3 })).not.toHaveText(todays);
  await expect(pickup.locator("[data-skeb-pickup-note]")).toBeHidden();
  // ピックアップは写しで、一覧からは消えない。
  await expect(titles).toHaveCount(17);

  const sort = main.getByRole("combobox", { name: "並び順" });
  await sort.selectOption("desc");
  await expect(titles).toHaveText(Array.from({ length: 17 }, (_, i) => `ボイス作品 #${17 - i}`));
  await sort.selectOption("shuffle");
  expect((await titles.allTextContents()).sort()).toEqual(
    Array.from({ length: 17 }, (_, i) => `ボイス作品 #${i + 1}`).sort(),
  );
  await sort.selectOption("asc");
  await expect(titles).toHaveText(Array.from({ length: 17 }, (_, i) => `ボイス作品 #${i + 1}`));

  const filter = main.getByRole("group", { name: "タグで絞り込む" });
  const [top] = sharedTags(data.works.flatMap((work) => (work.summary ? [work.summary.tags] : [])));
  test.skip(!top, "2作品以上に付いたタグが無い");
  const escaped = escapeRegExp(top!.tag);
  const tagButton = filter.getByRole("button", {
    name: new RegExp(`^#?${escaped} ?${top!.count} ?件$`),
  });
  await tagButton.click();
  await expect(tagButton).toHaveAttribute("aria-pressed", "true");
  await expect(list.locator("> li:visible")).toHaveCount(top!.count);
  const count = main.locator("[data-skeb-count]");
  await expect(count).toHaveText(new RegExp(`${escaped}\\D*(?<!\\d)${top!.count}(?!\\d)`));
  await tagButton.click();
  await expect(tagButton).toHaveAttribute("aria-pressed", "false");
  await expect(list.locator("> li:visible")).toHaveCount(17);
  await expect(count).not.toContainText(top!.tag);
  await expect(count).toHaveText(/(?<!\d)17(?!\d)/);

  // カードのタグも、絞り込みの列にあるものは押して絞り込める。もう一度押すと戻る。
  const cardTag = () =>
    list
      .locator("> li:visible")
      .getByRole("button", { name: new RegExp(`^#?${escaped} ?（このタグで絞り込む）$`) })
      .first();
  // 押したら、列の同じボタンへフォーカスが移る（一覧の上へ戻り、キーボードでも列から続けられる）。
  await cardTag().click();
  await expect(tagButton).toHaveAttribute("aria-pressed", "true");
  await expect(tagButton).toBeFocused();
  await expect(cardTag()).toHaveAttribute("aria-pressed", "true");
  await expect(list.locator("> li:visible")).toHaveCount(top!.count);
  await cardTag().click();
  await expect(tagButton).toHaveAttribute("aria-pressed", "false");
  await expect(filter.locator('[data-skeb-filter-tag=""]')).toBeFocused();
  await expect(cardTag()).toHaveAttribute("aria-pressed", "false");
  await expect(list.locator("> li:visible")).toHaveCount(17);
});

const OEMBED = /^https:\/\/publish\.x\.com\/oembed\?/;
const CORS = { "access-control-allow-origin": "*" };
const OEMBED_HTML =
  '<blockquote class="twitter-tweet" data-lang="ja" data-dnt="true"><p lang="ja" dir="ltr">本文の1行目<br>本文の2行目' +
  ' <a href="https://t.co/x">pic.twitter.com/x</a></p>&mdash; 投稿者 (@user) <a href="https://x.com/u/status/1">2024年3月26日</a></blockquote>';
const postCard = (page: Page, number: number) =>
  page
    .getByRole("main")
    .getByRole("list")
    .filter({ has: page.getByRole("heading", { level: 3 }) })
    .first()
    .locator("> li")
    .nth(number - 1);

/**
 * docs/adr/0022-x-embed-skeb-delivery-posts.md の決定。ページを開いただけでは X に何も伝えず、納品のポストを押したときに、
 * ダイアログを開いてから oEmbed を取り、widgets.js を読む。X には通信せず、page.route で oEmbed の応答を作る
 * （tests/e2e/references-x-embed.spec.ts の検査と同じ）。page.route は後に足したものが先に当たるので、
 * 外へ出さない route を先に、oEmbed の route を後に足す。
 */
test("Skeb — 納品のポストを押したら、ダイアログを開いてから X の oEmbed を取って差し込む", async ({
  page,
}) => {
  test.skip(!hasSkeb, "本番モードではページを生成しない");
  const externalRequests = await blockExternal(page);
  const requested: URL[] = [];
  await page.route(OEMBED, (route) => {
    requested.push(new URL(route.request().url()));
    return route.fulfill({ headers: CORS, json: { html: OEMBED_HTML } });
  });
  await page.goto("/skeb/", { waitUntil: "networkidle" });
  expect(externalRequests).toEqual([]);
  expect(requested).toEqual([]);

  const number = SKEB_WORKS.findIndex((work) => work.deliveryPost?.video) + 1;
  const work = SKEB_WORKS[number - 1]!;
  const link = postCard(page, number).getByRole("link", { name: /^X で試聴/ });
  await expect(link).toHaveAttribute("aria-haspopup", "dialog");
  await link.click();

  const dialog = page.getByRole("dialog", { name: `${work.title} の納品ポスト` });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("blockquote.twitter-tweet")).toHaveCount(1);
  expect(
    requested.map((url) =>
      Object.fromEntries(
        ["url", "omit_script", "dnt", "lang", "hide_thread"].map((key) => [
          key,
          url.searchParams.get(key),
        ]),
      ),
    ),
  ).toEqual([
    {
      url: work.deliveryPost!.url,
      omit_script: "true",
      dnt: "true",
      lang: "ja",
      hide_thread: "true",
    },
  ]);
  await expect.poll(() => externalRequests).toEqual(["https://platform.x.com/widgets.js"]);

  const results = await new AxeBuilder({ page })
    .withTags(AXE_TAGS)
    .exclude(THIRD_PARTY_EMBED)
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" / ")}`),
  ).toEqual([]);

  // 閉じたら中身を消し（動画が鳴り続けないため）、押したリンクへ戻る。
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(link).toBeFocused();
  await expect(page.locator("[data-skeb-x-embed] > *")).toHaveCount(0);

  // widgets.js は外へ出さない route が止めたので読めていない。次に押したら読み直す。oEmbed は取り直さない。
  await link.click();
  await expect(dialog.locator("blockquote.twitter-tweet")).toHaveCount(1);
  await expect
    .poll(() => externalRequests)
    .toEqual(["https://platform.x.com/widgets.js", "https://platform.x.com/widgets.js"]);
  expect(requested).toHaveLength(1);
});

test("Skeb — 納品のポストの oEmbed が取れなかったら、ダイアログの中はポストへのリンクのまま残す", async ({
  page,
}) => {
  test.skip(!hasSkeb, "本番モードではページを生成しない");
  await blockExternal(page);
  await page.route(OEMBED, (route) => route.fulfill({ status: 404, headers: CORS, body: "" }));
  await page.goto("/skeb/");

  const number = SKEB_WORKS.findIndex((work) => work.deliveryPost) + 1;
  const work = SKEB_WORKS[number - 1]!;
  const responded = page.waitForResponse(OEMBED);
  await postCard(page, number).locator("[data-x-post] a").click();
  await responded;

  const dialog = page.getByRole("dialog", { name: `${work.title} の納品ポスト` });
  await expect(dialog.getByRole("link", { name: /^X でポストを見る/ })).toHaveAttribute(
    "href",
    work.deliveryPost!.url,
  );
  await expect(dialog.locator("blockquote")).toHaveCount(0);
  await dialog.getByRole("button", { name: "閉じる" }).last().click();
  await expect(dialog).toBeHidden();
});

test("Skeb — 狭い画面では、タグの絞り込みを1行にし、収まらなければ「すべて見る」で折り返す", async ({
  page,
}) => {
  test.skip(!hasSkeb, "本番モードではページを生成しない");
  await blockExternal(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/skeb/");
  const filter = page.getByRole("group", { name: "タグで絞り込む" });
  const tags = filter.locator("[aria-pressed]");
  await expect(tags.first()).toBeVisible();
  const overflows = await tags
    .first()
    .evaluate(
      (button) =>
        button.parentElement!.scrollWidth > button.parentElement!.parentElement!.clientWidth,
    );
  const expand = filter.getByRole("button", { name: "すべて見る" });
  await expect(expand).toBeVisible({ visible: overflows });
  // 1行のまま横にはみ出したタグが、ページごと横にスクロールさせない。
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  if (!overflows) return;
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expand.click();
  const close = filter.getByRole("button", { name: "閉じる" });
  await expect(close).toHaveAttribute("aria-expanded", "true");
  for (const box of await Promise.all((await tags.all()).map((button) => button.boundingBox()))) {
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await close.click();
  await expect(filter.getByRole("button", { name: "すべて見る" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("Skeb — 画面を広げてタグが1行に収まれば、「すべて見る」を消す", async ({ page }) => {
  test.skip(!hasSkeb, "本番モードではページを生成しない");
  await blockExternal(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/skeb/");
  const filter = page.getByRole("group", { name: "タグで絞り込む" });
  const expand = filter.getByRole("button", { name: "すべて見る" });
  await expect(expand).toBeVisible();
  const first = filter.locator("[aria-pressed]").first();
  // 今のデータでは、いちばん広い幅でもタグが1行に収まらないので、タグを減らして収まる場面を作る。
  await first.evaluate((button) => {
    const bar = button.parentElement!;
    while (bar.children.length > 3) bar.lastElementChild!.remove();
  });
  const measure = () =>
    first.evaluate((button) => {
      const bar = button.parentElement!;
      const row = bar.parentElement!;
      return {
        tags: bar.scrollWidth,
        row: row.clientWidth,
        button: row.clientWidth - bar.clientWidth,
      };
    });
  // 「すべて見る」が出たままだと収まらず、消せば収まる幅にする。ボタンの幅を引いた列の幅で比べると、ボタンが残る幅。
  const narrow = await measure();
  expect(narrow.tags).toBeGreaterThan(narrow.row);
  const target = narrow.tags + Math.floor(narrow.button / 2);
  let width = 360 + target - narrow.row;
  await page.setViewportSize({ width, height: 800 });
  width += target - (await measure()).row;
  await page.setViewportSize({ width, height: 800 });
  const { row } = await measure();
  expect(row).toBeGreaterThanOrEqual(narrow.tags);
  expect(row).toBeLessThan(narrow.tags + narrow.button);
  await expect(expand).toBeHidden();
});
