import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { AXE_TAGS, THIRD_PARTY_EMBED } from "../helpers/axe";
import { X_HOST } from "../helpers/x-embed";

/**
 * playwright.config.ts の BLOCK_EXTERNAL_EMBEDS が効いていることを見る。
 *
 * 止めるホストは設定に文字で書いてあり、ページの widgets.js の URL（src/components/XPost.astro）とはつながっていない。
 * ページの読み込み先を変えると、許可リストと性能予算（tests/artifact/）は落ちて気付けるが、止める側は誰も見ておらず、
 * 規約テストが X を読む状態に黙って戻り、結果が X の描き方と通信に左右される。そこで、規約テストのブラウザで
 * /references/ を開いたとき、X のホストから何も読めていないことと、埋め込みが出なかったときのリンクが残っていることを見る。
 *
 * 通信が止むまで（networkidle）待つ。load までだと、widgets.js を load の後に読む形（見えたら・押したら読む）に
 * 変えたとき、読みに行く前に終わってしまう。数えるのは読み終えたもの（requestfinished）で、止めたホストへの
 * 読み込みは失敗するので数えない。
 */
test("規約テストでは X の埋め込みを読まない — /references/", async ({ page }) => {
  const fromX: string[] = [];
  page.on("requestfinished", (request) => {
    if (X_HOST.test(new URL(request.url()).hostname)) fromX.push(request.url());
  });

  await page.goto("/references/", { waitUntil: "networkidle" });

  expect(fromX, "X のホストから読めたもの").toEqual([]);
  await expect(page.locator("[data-x-post] a[href]")).toHaveCount(1);
  await expect(page.locator("[data-x-post] blockquote")).toHaveCount(0);
});

/**
 * src/components/XPost.astro の、oEmbed を取って差し込むスクリプト（/references/ で見る）。
 *
 * X には通信せず、page.route で oEmbed の応答を作る。BLOCK_EXTERNAL_EMBEDS は名前を引けなくするだけで、page.route はその前に
 * 横取りする。別オリジンへの fetch なので、作る応答にも CORS のヘッダーを付ける（本物の publish.x.com も付けて返す）。
 * widgets.js は止めたままなので、差し込んだ引用がそのまま残る。
 *
 * 作る応答は、本物の oEmbed の html と同じ形（本文の改行・ハッシュタグと画像のリンク・投稿者・日付のリンク）にする。
 * 差し込んだ引用は、widgets.js が描くまでのあいだ（と widgets.js だけが止められたとき）に出て、このページのスタイルが
 * 当たるので、その状態でも WCAG A/AA を見る（tests/conformance/routes.spec.ts の axe は、X を止めたリンクだけの状態しか見ない）。
 */
const OEMBED = /^https:\/\/publish\.x\.com\/oembed\?/;
const CORS = { "access-control-allow-origin": "*" };

test("oEmbed が返したら、ページのリンクのポストの埋め込みのコードを差し込む — /references/", async ({
  page,
}) => {
  const requested: URL[] = [];
  // ページのリンクは差し込むと消えるので、応答を返す前（横取りした時点）に読む。スクリプトと同じく、解決した URL（a.href）で。
  let href: string | null = null;
  await page.route(OEMBED, async (route) => {
    requested.push(new URL(route.request().url()));
    href = await page.locator("[data-x-post] a[href]").evaluate((a: HTMLAnchorElement) => a.href);
    return route.fulfill({
      headers: CORS,
      json: {
        html:
          '<blockquote class="twitter-tweet" data-lang="ja" data-dnt="true"><p lang="ja" dir="ltr">本文の1行目<br>本文の2行目' +
          '<a href="https://x.com/hashtag/tag?src=hash">#タグ</a> <a href="https://t.co/x">pic.twitter.com/x</a></p>' +
          '&mdash; 投稿者 (@user) <a href="https://x.com/u/status/1">2022年1月22日</a></blockquote>',
      },
    });
  });
  await page.goto("/references/");

  await expect(page.locator("[data-x-post] blockquote.twitter-tweet")).toHaveCount(1);
  await expect(page.locator("[data-x-post] > p")).toHaveCount(0);
  // 頼む中身: ページのリンクのポストを、widgets.js の script を外し、個人向けの調整に使わせない形で。
  expect(
    requested.map((url) =>
      Object.fromEntries(
        ["url", "omit_script", "dnt", "lang"].map((key) => [key, url.searchParams.get(key)]),
      ),
    ),
  ).toEqual([{ url: href, omit_script: "true", dnt: "true", lang: "ja" }]);

  const results = await new AxeBuilder({ page })
    .withTags(AXE_TAGS)
    .exclude(THIRD_PARTY_EMBED)
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" / ")}`),
  ).toEqual([]);
});

test("oEmbed が取れなかったら、ポストへのリンクのまま残す — /references/", async ({ page }) => {
  await page.route(OEMBED, (route) => route.fulfill({ status: 404, headers: CORS, body: "" }));
  await page.goto("/references/", { waitUntil: "networkidle" });

  await expect(page.locator("[data-x-post] a[href]")).toHaveCount(1);
  await expect(page.locator("[data-x-post] blockquote")).toHaveCount(0);
});

test("oEmbed が blockquote でない html を返したら、差し込まない — /references/", async ({
  page,
}) => {
  await page.route(OEMBED, (route) =>
    route.fulfill({ headers: CORS, json: { html: '<img src="x" alt="">' } }),
  );
  await page.goto("/references/", { waitUntil: "networkidle" });

  await expect(page.locator("[data-x-post] a[href]")).toHaveCount(1);
  await expect(page.locator("[data-x-post] img")).toHaveCount(0);
});
