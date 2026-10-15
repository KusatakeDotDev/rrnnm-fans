import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { AXE_TAGS, THIRD_PARTY_EMBED } from '../helpers/axe';
import { builtRoutes } from '../helpers/dist';
import rawData from '../../src/content/skeb-summaries.json' with { type: 'json' };
import { SKEB_WORKS } from '../../src/content/skeb';
import { dailyIndex, sharedTags } from '../../src/lib/skeb-browse';
import { validateSummaryData } from '../../src/lib/skeb-summary';
const data = validateSummaryData(rawData, SKEB_WORKS.map((work) => work.url));
const hasSkeb = builtRoutes().includes('/skeb/');

const sourceLabel = ({ quote }: NonNullable<(typeof data.works)[number]['summary']>) =>
  quote.provenance === 'user-provided' ? `運営者提供資料（${quote.retrieved} 資料受領）` : `Skeb の作品ページ（${quote.retrieved} 確認）`;

/** 127.0.0.1 の外への通信を止め、止めた URL を集める。 */
const blockExternal = async (page: Page) => {
  const externalRequests: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') {
      externalRequests.push(url.href);
      await route.abort();
    } else {
      await route.continue();
    }
  });
  return externalRequests;
};

for (const width of [320, 390, 1280]) {
  test(`Skeb — JS なしでもプロフィールと作品リンクを読める（${width}px）`, async ({ browser, baseURL }) => {
    // 17件のカードを1件ずつ見るので、ほかのテストと並べて回すと既定の30秒を超えることがある。
    test.setTimeout(60_000);
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width, height: 800 } });
    try {
      const page = await context.newPage();
      const externalRequests = await blockExternal(page);
      if (!hasSkeb) {
        expect((await page.goto('/skeb/'))?.status()).toBe(404);
        return;
      }
      await page.goto('/skeb/');
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1 })).toHaveText('Skeb ボイス作品紹介');
      const profile = main.getByRole('link', { name: 'Skeb でプロフィールを見る', exact: false });
      await expect(profile).toBeVisible();
      await expect(profile).toHaveAttribute('href', 'https://skeb.jp/@rurino_nemo');
      await expect(profile).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(profile).toHaveAccessibleName(/外部サイトを新しいタブで開く/);
      await expect(main.locator('img, iframe, video, audio, object, embed')).toHaveCount(0);

      // ピックアップ・並べ替え・絞り込みは JS の上乗せ。JS が無ければ、押しても何も起きない操作を出さない。
      await expect(main.getByRole('heading', { name: '今日のピックアップ' })).toHaveCount(0);
      await expect(main.getByRole('button')).toHaveCount(0);
      await expect(main.getByRole('combobox')).toHaveCount(0);

      const cards = main.getByRole('list').filter({ has: page.getByRole('heading', { level: 3 }) }).first().locator('> li');
      await expect(cards).toHaveCount(17);
      for (let number = 1; number <= 17; number++) {
        const card = cards.nth(number - 1);
        await expect(card.getByRole('heading', { level: 3 })).toHaveText(`ボイス作品 #${number}`);
        const work = SKEB_WORKS[number - 1]!;
        await expect(card.getByRole('link')).toHaveCount(1 + (work.deliveryPost ? 1 : 0) + (work.youtube ? 1 : 0));
        const link = card.getByRole('link', { name: /^Skeb で聴く/ });
        await expect(link).toHaveCount(1);
        await expect(link).toHaveAttribute('href', `https://skeb.jp/@rurino_nemo/works/${number}`);
        await expect(link).toHaveAccessibleName(new RegExp(`^Skeb で聴く ↗ ?（ボイス作品 #${number}。外部サイトを新しいタブで開く）$`));
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        // 納品のポストと YouTube は、JS が無ければ外部サイトへのリンク。
        const post = card.locator('[data-x-post] a');
        if (work.deliveryPost) {
          await expect(post).toHaveAttribute('href', work.deliveryPost.url);
          await expect(post).toHaveAccessibleName(
            new RegExp(`^${work.deliveryPost.video ? 'X で試聴' : 'X の納品ポスト'} ?（ボイス作品 #${number}の納品ポスト。外部サイトを新しいタブで開く）$`),
          );
          await expect(post).toHaveAttribute('target', '_blank');
          await expect(post).toHaveAttribute('rel', 'noopener noreferrer');
        } else {
          await expect(post).toHaveCount(0);
        }
        if (work.youtube) {
          const youtube = card.getByRole('link', { name: /^YouTube で聴く/ });
          await expect(youtube).toHaveAttribute('href', work.youtube);
          await expect(youtube).toHaveAccessibleName(new RegExp(`^YouTube で聴く ↗ ?（ボイス作品 #${number}。外部サイトを新しいタブで開く）$`));
          await expect(youtube).toHaveAttribute('target', '_blank');
          await expect(youtube).toHaveAttribute('rel', 'noopener noreferrer');
        }
        const summary = data.works[number - 1].summary;
        if (summary) {
          await expect(card.locator('blockquote')).toHaveText(summary.quote.text);
          await expect(card.locator('blockquote > *')).toHaveCount(0);
          if (summary.quote.provenance === 'user-provided') {
            await expect(card.locator('blockquote')).not.toHaveAttribute('cite');
          } else {
            await expect(card.locator('blockquote')).toHaveAttribute('cite', summary.quote.url);
          }
          await expect(card.getByText(summary.heading, { exact: true })).toBeVisible();
          await expect(card.getByRole('list', { name: '作品のタグ' }).getByRole('listitem')).toHaveText(summary.tags);
          await expect(card.getByText('一部の音声を紹介', { exact: true })).toHaveCount([9, 11].includes(number) ? 1 : 0);
          // 出典はカードに書かず、一覧の下で1回だけ言う。
          await expect(card).not.toContainText('出典');
        } else {
          await expect(card.locator('blockquote')).toHaveCount(0);
        }
        expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      }

      const notes = main.locator('footer');
      const summaries = data.works.flatMap((work) => work.summary ?? []);
      if (summaries.length > 0) await expect(notes).toContainText('セリフの出典：');
      for (const summary of summaries) await expect(notes).toContainText(sourceLabel(summary));
      await expect(notes.getByRole('link')).toHaveCount(0);
      await expect(main).toContainText('瑠璃野ねもさんが演じた');
      await expect(notes).toContainText('案内用の名前');
      if (summaries.some((summary) => summary.quote.provenance === 'user-provided')) {
        await expect(notes).toContainText('原音との照合を行っていません');
      }
      await expect(main.getByRole('searchbox')).toHaveCount(0);
      await expect(main).not.toContainText('確認日：');
      await expect(main).not.toContainText('個別作品のリンクは確認中です。');
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(externalRequests).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test('Skeb — JS 有効でも外部サービスへ自動取得しない', async ({ page }) => {
  test.skip(!hasSkeb, '本番モードではページを生成しない');
  const externalRequests = await blockExternal(page);
  await page.goto('/skeb/');
  await page.waitForLoadState('networkidle');
  expect(externalRequests).toEqual([]);
});

test('Skeb — JS があれば、日替わりのピックアップ・並べ替え・タグの絞り込みを使える', async ({ page }) => {
  test.skip(!hasSkeb, '本番モードではページを生成しない');
  await blockExternal(page);
  // 日本時間 2026-10-14 の昼。ピックアップは日本時間の日付で決まる。
  await page.clock.setFixedTime(new Date('2026-10-14T03:00:00Z'));
  await page.goto('/skeb/');
  const main = page.getByRole('main');
  const list = main.getByRole('list').filter({ has: page.getByRole('heading', { level: 3 }) }).first();
  const titles = list.locator('> li').getByRole('heading', { level: 3 });

  const approved = data.works.flatMap((work, index) => (work.summary ? [index + 1] : []));
  const pickup = main.getByRole('region', { name: '今日のピックアップ' });
  await expect(pickup).toBeVisible();
  await expect(pickup).toContainText('2026.10.14 の日替わり');
  const todays = `ボイス作品 #${approved[dailyIndex('2026-10-14', approved.length)]}`;
  await expect(pickup.getByRole('heading', { level: 3 })).toHaveText(todays);

  await pickup.getByRole('button', { name: '別の作品を引く' }).click();
  const drawn = main.getByRole('region', { name: 'ランダムピックアップ' });
  await expect(drawn.getByRole('heading', { level: 3 })).not.toHaveText(todays);
  await expect(drawn.getByText('日替わり')).toBeHidden();
  // ピックアップは写しで、一覧からは消えない。
  await expect(titles).toHaveCount(17);

  const sort = main.getByRole('combobox', { name: '並び順' });
  await sort.selectOption('desc');
  await expect(titles).toHaveText(Array.from({ length: 17 }, (_, i) => `ボイス作品 #${17 - i}`));
  await sort.selectOption('shuffle');
  expect((await titles.allTextContents()).sort()).toEqual(Array.from({ length: 17 }, (_, i) => `ボイス作品 #${i + 1}`).sort());
  await sort.selectOption('asc');
  await expect(titles).toHaveText(Array.from({ length: 17 }, (_, i) => `ボイス作品 #${i + 1}`));

  const filter = main.getByRole('group', { name: 'タグで絞り込む' });
  const [top] = sharedTags(data.works.flatMap((work) => (work.summary ? [work.summary.tags] : [])));
  test.skip(!top, '2作品以上に付いたタグが無い');
  const escaped = top!.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagButton = filter.getByRole('button', { name: new RegExp(`^#?${escaped} ?${top!.count} ?件$`) });
  await tagButton.click();
  await expect(tagButton).toHaveAttribute('aria-pressed', 'true');
  await expect(list.locator('> li:visible')).toHaveCount(top!.count);
  await expect(main.getByText(`（#${top!.tag}：${top!.count}件）`, { exact: true })).toBeVisible();
  await tagButton.click();
  await expect(tagButton).toHaveAttribute('aria-pressed', 'false');
  await expect(list.locator('> li:visible')).toHaveCount(17);
  await expect(main.getByText('（全17件）', { exact: true })).toBeVisible();

  // カードのタグも、絞り込みの列にあるものは押して絞り込める。もう一度押すと戻る。
  const cardTag = () => list.locator('> li:visible').getByRole('button', { name: new RegExp(`^#?${escaped} ?（このタグで絞り込む）$`) }).first();
  // 押したら、列の同じボタンへフォーカスが移る（一覧の上へ戻り、キーボードでも列から続けられる）。
  await cardTag().click();
  await expect(tagButton).toHaveAttribute('aria-pressed', 'true');
  await expect(tagButton).toBeFocused();
  await expect(cardTag()).toHaveAttribute('aria-pressed', 'true');
  await expect(list.locator('> li:visible')).toHaveCount(top!.count);
  await cardTag().click();
  await expect(tagButton).toHaveAttribute('aria-pressed', 'false');
  await expect(filter.locator('[data-skeb-filter-tag=""]')).toBeFocused();
  await expect(cardTag()).toHaveAttribute('aria-pressed', 'false');
  await expect(list.locator('> li:visible')).toHaveCount(17);
});

const OEMBED = /^https:\/\/publish\.x\.com\/oembed\?/;
const CORS = { 'access-control-allow-origin': '*' };
const OEMBED_HTML =
  '<blockquote class="twitter-tweet" data-lang="ja" data-dnt="true"><p lang="ja" dir="ltr">本文の1行目<br>本文の2行目' +
  ' <a href="https://t.co/x">pic.twitter.com/x</a></p>&mdash; 投稿者 (@user) <a href="https://x.com/u/status/1">2024年3月26日</a></blockquote>';
const postCard = (page: Page, number: number) =>
  page.getByRole('main').getByRole('list').filter({ has: page.getByRole('heading', { level: 3 }) }).first().locator('> li').nth(number - 1);

/**
 * docs/adr/0022-x-embed-skeb-delivery-posts.md の決定。ページを開いただけでは X に何も伝えず、納品のポストを押したときに、
 * ダイアログを開いてから oEmbed を取り、widgets.js を読む。X には通信せず、page.route で oEmbed の応答を作る
 * （tests/conformance/x-embed.spec.ts の /references/ の検査と同じ）。page.route は後に足したものが先に当たるので、
 * 外へ出さない route を先に、oEmbed の route を後に足す。
 */
test('Skeb — 納品のポストを押したら、ダイアログを開いてから X の oEmbed を取って差し込む', async ({ page }) => {
  test.skip(!hasSkeb, '本番モードではページを生成しない');
  const externalRequests = await blockExternal(page);
  const requested: URL[] = [];
  await page.route(OEMBED, (route) => {
    requested.push(new URL(route.request().url()));
    return route.fulfill({ headers: CORS, json: { html: OEMBED_HTML } });
  });
  await page.goto('/skeb/', { waitUntil: 'networkidle' });
  expect(externalRequests).toEqual([]);
  expect(requested).toEqual([]);

  const number = SKEB_WORKS.findIndex((work) => work.deliveryPost?.video) + 1;
  const work = SKEB_WORKS[number - 1]!;
  const link = postCard(page, number).getByRole('link', { name: /^X で試聴/ });
  await expect(link).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(link).toHaveAccessibleName(/このページの中で開く/);
  await link.click();

  const dialog = page.getByRole('dialog', { name: `${work.title} の納品ポスト` });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('blockquote.twitter-tweet')).toHaveCount(1);
  expect(
    requested.map((url) =>
      Object.fromEntries(['url', 'omit_script', 'dnt', 'lang', 'hide_thread'].map((key) => [key, url.searchParams.get(key)])),
    ),
  ).toEqual([{ url: work.deliveryPost!.url, omit_script: 'true', dnt: 'true', lang: 'ja', hide_thread: 'true' }]);
  await expect.poll(() => externalRequests).toEqual(['https://platform.x.com/widgets.js']);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude(THIRD_PARTY_EMBED).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' / ')}`)).toEqual([]);

  // 閉じたら中身を消し（動画が鳴り続けないため）、押したリンクへ戻る。
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(link).toBeFocused();
  await expect(page.locator('[data-skeb-x-embed] > *')).toHaveCount(0);

  // widgets.js は外へ出さない route が止めたので読めていない。次に押したら読み直す。oEmbed は取り直さない。
  await link.click();
  await expect(dialog.locator('blockquote.twitter-tweet')).toHaveCount(1);
  await expect.poll(() => externalRequests).toEqual(['https://platform.x.com/widgets.js', 'https://platform.x.com/widgets.js']);
  expect(requested).toHaveLength(1);
});

test('Skeb — 納品のポストの oEmbed が取れなかったら、ダイアログの中はポストへのリンクのまま残す', async ({ page }) => {
  test.skip(!hasSkeb, '本番モードではページを生成しない');
  await blockExternal(page);
  await page.route(OEMBED, (route) => route.fulfill({ status: 404, headers: CORS, body: '' }));
  await page.goto('/skeb/');

  const number = SKEB_WORKS.findIndex((work) => work.deliveryPost) + 1;
  const work = SKEB_WORKS[number - 1]!;
  const responded = page.waitForResponse(OEMBED);
  await postCard(page, number).locator('[data-x-post] a').click();
  await responded;

  const dialog = page.getByRole('dialog', { name: `${work.title} の納品ポスト` });
  await expect(dialog.getByRole('link', { name: /^X でポストを見る/ })).toHaveAttribute('href', work.deliveryPost!.url);
  await expect(dialog.locator('blockquote')).toHaveCount(0);
  await dialog.getByRole('button', { name: '閉じる' }).last().click();
  await expect(dialog).toBeHidden();
});

test('Skeb — 狭い画面では、タグの絞り込みを1行にし、収まらなければ「すべて見る」で折り返す', async ({ page }) => {
  test.skip(!hasSkeb, '本番モードではページを生成しない');
  await blockExternal(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/skeb/');
  const filter = page.getByRole('group', { name: 'タグで絞り込む' });
  const tags = filter.locator('[aria-pressed]');
  await expect(tags.first()).toBeVisible();
  const overflows = await tags.first().evaluate((button) => button.parentElement!.scrollWidth > button.parentElement!.parentElement!.clientWidth);
  const expand = filter.getByRole('button', { name: 'すべて見る' });
  await expect(expand).toBeVisible({ visible: overflows });
  // 1行のまま横にはみ出したタグが、ページごと横にスクロールさせない。
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (!overflows) return;
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.click();
  const close = filter.getByRole('button', { name: '閉じる' });
  await expect(close).toHaveAttribute('aria-expanded', 'true');
  for (const box of await Promise.all((await tags.all()).map((button) => button.boundingBox()))) {
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await close.click();
  await expect(filter.getByRole('button', { name: 'すべて見る' })).toHaveAttribute('aria-expanded', 'false');
});

test('Skeb — 画面を広げてタグが1行に収まれば、「すべて見る」を消す', async ({ page }) => {
  test.skip(!hasSkeb, '本番モードではページを生成しない');
  await blockExternal(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/skeb/');
  const filter = page.getByRole('group', { name: 'タグで絞り込む' });
  const expand = filter.getByRole('button', { name: 'すべて見る' });
  await expect(expand).toBeVisible();
  const first = filter.locator('[aria-pressed]').first();
  // 今のデータでは、いちばん広い幅でもタグが1行に収まらないので、タグを減らして収まる場面を作る。
  await first.evaluate((button) => {
    const bar = button.parentElement!;
    while (bar.children.length > 3) bar.lastElementChild!.remove();
  });
  const measure = () =>
    first.evaluate((button) => {
      const bar = button.parentElement!;
      const row = bar.parentElement!;
      return { tags: bar.scrollWidth, row: row.clientWidth, button: row.clientWidth - bar.clientWidth };
    });
  // 「すべて見る」が出たままだと収まらず、消せば収まる幅にする。ボタンの幅を引いた列の幅で比べると、ボタンが残る幅。
  const narrow = await measure();
  expect(narrow.tags).toBeGreaterThan(narrow.row);
  const target = narrow.tags + Math.floor(narrow.button / 2);
  let width = 320 + target - narrow.row;
  await page.setViewportSize({ width, height: 800 });
  width += target - (await measure()).row;
  await page.setViewportSize({ width, height: 800 });
  const { row } = await measure();
  expect(row).toBeGreaterThanOrEqual(narrow.tags);
  expect(row).toBeLessThan(narrow.tags + narrow.button);
  await expect(expand).toBeHidden();
});

for (const route of builtRoutes()) {
  test(`Skeb — ${route} から、フッターでだけたどれる`, async ({ page }) => {
    await page.goto(route);
    const links = page.locator('a[href="/skeb/"]');
    if (!hasSkeb) {
      await expect(links).toHaveCount(0);
      return;
    }
    const footerLink = page.locator('footer').getByRole('link', { name: 'Skeb', exact: true });
    await expect(footerLink).toHaveAttribute('href', '/skeb/');
    await expect(links).toHaveCount(1);
    await footerLink.click();
    await expect(page).toHaveURL(/\/skeb\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Skeb ボイス作品紹介', exact: true })).toBeVisible();
  });
}
