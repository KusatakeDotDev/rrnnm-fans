import { expect, type Page, test } from '@playwright/test';

import { SCHEDULE_VIDEO_ID, T_WINDOW_MS } from '../../src/components/schedule';

/**
 * docs/adr/0004-schedule-thumbnail.md「サムネイルの URL にクエリを付ける」
 *
 * 予定のカードのサムネイルは、直後のインラインのスクリプト（src/components/ScheduleCard.tsx の `LOAD_THUMBNAIL`）が、
 * 5分ごとに変わるクエリ `t` を付けた URL に替え、読み込みとデコードが済んでからフェードで出す。スクリプトが例外で止まる・
 * `<img>` を包んで直後でなくなる、のどちらが起きても、ビルドの HTML は変わらず、画像も（クエリ無しで）出るので、
 * ほかの検査では気付けない。ブラウザで開いて確かめる。
 *
 * **i.ytimg.com への取得は、このテストの中で返す。** 本物の YouTube に頼ると、外の回線が揺れただけで落ちる。
 * 返すのは、パスの名前どおりの大きさの SVG（maxresdefault は 1280×720、hqdefault は 480×360）。
 *
 * 固定成功 build と本番用 build に対して必ず実行する。画像が無ければ検査は失敗する。
 */
const thumbnail = `[data-youtube-thumbnail] img[src*="/vi/${SCHEDULE_VIDEO_ID}/"]`;
const SIZES: Record<string, readonly [number, number]> = { maxresdefault: [1280, 720], hqdefault: [480, 360] };

/**
 * i.ytimg.com の画像をテストの中で返し、取りに来た URL を集める。`t` の付いた URL には、`broken` が
 * `'missing'` なら YouTube が無い画像に返すもの（404 と 120×90 の画像）を、`'error'` なら通信の失敗を返す。
 * `plainDelayMs`・`tDelayMs` は、クエリ無しの URL・`t` の付いた URL を返すまで待つ時間。どれも取りに来るたびに読むので、途中で替えられる。
 */
async function serveThumbnails(
  page: Page,
  options: { broken?: 'missing' | 'error' | undefined; plainDelayMs?: number; tDelayMs?: number } = {},
): Promise<string[]> {
  const requested: string[] = [];
  await page.route(/^https:\/\/i\.ytimg\.com\//, async (route) => {
    const url = new URL(route.request().url());
    requested.push(url.href);
    const hasT = url.searchParams.has('t');
    if (options.broken === 'error' && hasT) return route.abort();
    const delay = (hasT ? options.tDelayMs : options.plainDelayMs) ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const missing = options.broken === 'missing' && hasT;
    const [width, height] = (!missing && SIZES[/\/(\w+)\.jpg$/.exec(url.pathname)?.[1] ?? '']) || [120, 90];
    return route.fulfill({
      status: missing ? 404 : 200,
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`,
    });
  });
  return requested;
}

/** 例外を集める。`img.src` を替えたあとで投げても、画像は出るので、ほかの assert では気付けない。 */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** 読み込み終わり、幅が `width` 属性（ビルド時に決めた本物の大きさ）と同じ画像が出ているか。 */
const drawn = (page: Page) =>
  page
    .locator(thumbnail)
    .evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth === Number(el.getAttribute('width')));

type LoadingRecord = { loading: boolean; drawn: boolean; t: string | null };

/**
 * `data-loading` が付いたり外れたりするたびに、付いたか（`loading`）、そのとき出ていた画像が描けていたか（幅が `width` 属性と
 * 同じか）と、`t` を残す。外れるのは、読み込みとデコードが済んでからのはず。届く前の様子を、時間の幅に頼らずに確かめるために
 * 使う（「届く前に見る」形にすると、遅い CI では先に届いてしまうことがある）。再生リストの表紙も data-loading を使うので、
 * 予定のサムネイルに絞る。
 */
async function recordLoading(page: Page): Promise<() => Promise<LoadingRecord[]>> {
  await page.addInitScript((selector) => {
    const log: LoadingRecord[] = [];
    (window as unknown as { loadingLog: LoadingRecord[] }).loadingLog = log;
    new MutationObserver((records) => {
      for (const { target } of records) {
        const el = target as HTMLImageElement;
        if (!el.matches(selector)) continue;
        log.push({
          loading: el.hasAttribute('data-loading'),
          drawn: el.naturalWidth === Number(el.getAttribute('width')),
          t: new URL(el.src).searchParams.get('t'),
        });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-loading'] });
  }, thumbnail);
  return () => page.evaluate(() => (window as unknown as { loadingLog: LoadingRecord[] }).loadingLog);
}

/** 記録のうち、`data-loading` が外れたとき。 */
const reveals = (log: LoadingRecord[]) => log.filter(({ loading }) => !loading).map(({ drawn, t }) => ({ drawn, t }));

/** 出ている画像の URL と、その `t`（無ければ `null`）。 */
async function shown(page: Page): Promise<{ plain: string; t: string | null }> {
  const url = new URL(await page.locator(thumbnail).evaluate((el: HTMLImageElement) => el.currentSrc));
  const t = url.searchParams.get('t');
  url.searchParams.delete('t');
  return { plain: url.href, t };
}

test('開くと、t の付いた URL に替わって描ける。クエリ無しの URL は取りに行かない', async ({ page }) => {
  // スクリプトが、替えたあとの画像を待ったか（data-loading を付けたか）を残す。
  // <head> の preload が先に取りに行くので、t の付いた URL の返事を遅らせ、スクリプトが走る時点で届いていないようにする。
  const loadingLog = await recordLoading(page);
  // 区切りの頭に置く。本物の時計のままだと、preload とカードのスクリプトのあいだで区切りをまたぐことがある。
  await page.clock.install({ time: Math.floor(Date.now() / T_WINDOW_MS) * T_WINDOW_MS + 1_000 });
  const errors = collectErrors(page);
  const requested = await serveThumbnails(page, { tDelayMs: 1000 });

  await page.goto('/');
  await expect.poll(() => drawn(page)).toBe(true);
  const { plain, t } = await shown(page);
  expect(t).toMatch(/^\d+$/);
  // 予定の画像を取るのは、<head> の preload の1回だけ。lazy を外すと、プリロードスキャナーがクエリ無しの URL も取る。
  // カードの側のスクリプトが preload と別の URL を決めると、もう1回取る。
  const href = `${plain}?t=${t}`;
  expect(requested.filter((url) => url.includes(`/vi/${SCHEDULE_VIDEO_ID}/`))).toEqual([href]);
  await expect(page.locator('head link[rel="preload"][data-schedule-thumbnail]')).toHaveAttribute('href', href);

  // 付けて待ち、t の付いた画像が描けたときに1回だけ外す。
  expect((await loadingLog()).some(({ loading }) => loading)).toBe(true);
  expect(reveals(await loadingLog())).toEqual([{ drawn: true, t }]);
  await expect(page.locator(thumbnail)).not.toHaveAttribute('data-loading');
  expect(errors).toEqual([]);
});

test('5分たってタブに戻ると、前の画像を消さずに t を付け直す', async ({ page }) => {
  // 偽の時計は区切りの頭から1秒のところに置く。今の時刻から始めると、時計はそのあとも進むので、テストの途中で
  // 区切りをまたいで「同じ5分の中では取りに行かない」が落ちることがある。
  await page.clock.install({ time: Math.floor(Date.now() / T_WINDOW_MS) * T_WINDOW_MS + 1_000 });
  const errors = collectErrors(page);
  const requested = await serveThumbnails(page);
  await page.goto('/');
  await expect.poll(() => drawn(page)).toBe(true);
  const before = await shown(page);

  // src が替わった瞬間に、もう描ける画像になっているか（前の画像が消えて、枠の地が見えないか）を残す。
  await page.locator(thumbnail).evaluate((img: HTMLImageElement) => {
    const swaps: boolean[] = [];
    (window as unknown as { swaps: boolean[] }).swaps = swaps;
    new MutationObserver(() => swaps.push(img.complete && img.naturalWidth > 0)).observe(img, {
      attributes: true,
      attributeFilter: ['src'],
    });
  });
  const returnToTab = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  await page.clock.fastForward('05:00');
  await returnToTab();
  await expect.poll(async () => (await shown(page)).t).not.toBe(before.t);
  expect(await drawn(page)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { swaps: boolean[] }).swaps)).toEqual([true]);
  await expect(page.locator(thumbnail)).not.toHaveAttribute('data-loading');

  // 同じ5分の中でもう一度戻っても、取りに行かない。再生リストの表紙も i.ytimg.com から来るので、予定の動画だけを数える。
  const ours = () => requested.filter((url) => url.includes(`/vi/${SCHEDULE_VIDEO_ID}/`)).length;
  const count = ours();
  await returnToTab();
  await page.waitForTimeout(500);
  expect(ours()).toBe(count);

  // bfcache から戻ったとき（pageshow の persisted）も付け直す。persisted でない pageshow では付け直さない。
  const showPage = (persisted: boolean) =>
    page.evaluate((p) => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: p })), persisted);
  const { t } = await shown(page);
  await page.clock.fastForward('05:00');
  await showPage(false);
  await page.waitForTimeout(500);
  expect((await shown(page)).t).toBe(t);
  await showPage(true);
  await expect.poll(async () => (await shown(page)).t).not.toBe(t);
  expect(errors).toEqual([]);
});

test('最初の画像を待っているあいだに付け直したら、付け直した画像で出す', async ({ page }) => {
  await page.clock.install({ time: Math.floor(Date.now() / T_WINDOW_MS) * T_WINDOW_MS + 1_000 });
  const errors = collectErrors(page);
  // 最初の t の画像だけ遅らせる。付け直した t は、すぐに返す。
  let first: string | undefined;
  await page.route(/^https:\/\/i\.ytimg\.com\//, async (route) => {
    const url = new URL(route.request().url());
    const t = url.searchParams.get('t');
    first ??= t ?? undefined;
    if (t !== null && t === first) await new Promise((resolve) => setTimeout(resolve, 3000));
    const [width, height] = SIZES[/\/(\w+)\.jpg$/.exec(url.pathname)?.[1] ?? ''] ?? [120, 90];
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`,
    });
  });
  // preload はページの load を遅らせるので、load まで待つと最初の画像も届いてしまう。
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const img = page.locator(thumbnail);
  await expect(img).toHaveAttribute('data-loading', '');

  await page.clock.fastForward('05:00');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  // 付け直した画像に替わり、data-loading も外れる（最初の画像はまだ届いていない）。
  await expect.poll(async () => (await shown(page)).t).not.toBe(first);
  expect(await drawn(page)).toBe(true);
  await expect(img).not.toHaveAttribute('data-loading');
  expect(errors).toEqual([]);
});

test('t の付いた URL が「無い」画像を返したら、クエリ無しの URL に戻し、届くまで透明にしておく', async ({ page }) => {
  const errors = collectErrors(page);
  const loadingLog = await recordLoading(page);
  // t の付いた URL の返事を遅らせ、スクリプトが data-loading を付けて待っているところへ「無い」画像を届ける。
  await serveThumbnails(page, { broken: 'missing', tDelayMs: 500, plainDelayMs: 1000 });
  await page.goto('/');
  await expect.poll(() => drawn(page)).toBe(true);
  expect((await shown(page)).t).toBeNull();
  // 外れたのは、クエリ無しの画像が描けたときの1回だけ（「無い」画像のときには外れていない）。
  expect(reveals(await loadingLog())).toEqual([{ drawn: true, t: null }]);
  expect(errors).toEqual([]);
});

test('t の付いた URL が取れなかったら、クエリ無しの URL に戻してフェードで出し、次の機会に t を取り直す', async ({ page }) => {
  const errors = collectErrors(page);
  const loadingLog = await recordLoading(page);
  const options: { broken?: 'error'; plainDelayMs: number } = { broken: 'error', plainDelayMs: 1000 };
  await serveThumbnails(page, options);
  await page.goto('/');
  await expect.poll(() => drawn(page)).toBe(true);
  expect((await shown(page)).t).toBeNull();
  // クエリ無しに戻した画像は透明にして待ち、外れたのは、それが描けたときの1回だけ。
  expect(reveals(await loadingLog())).toEqual([{ drawn: true, t: null }]);

  // 回線が戻ったあと、同じ5分の中でもタブに戻れば、t の付いた URL を取り直す。
  options.broken = undefined;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(async () => (await shown(page)).t).toMatch(/^\d+$/);
  expect(await drawn(page)).toBe(true);
  expect(errors).toEqual([]);
});

/**
 * `loading` を知らないブラウザ（iOS Safari 15.4 より前など）では lazy が効かず、プリロードスキャナーがクエリ無しの URL を
 * 先に取る。そこで `?t=` 付きを取ると2回になるので、どちらのスクリプトも何もしない。ここでは `loading` を消して、
 * スクリプトの判定の側だけを確かめる（Chromium のパーサーは lazy を効かせたまま）。
 */
test('loading を知らないブラウザでは、クエリ無しの URL のままにする', async ({ page }) => {
  await page.addInitScript(() => {
    delete (HTMLImageElement.prototype as { loading?: unknown }).loading;
  });
  const errors = collectErrors(page);
  const requested = await serveThumbnails(page);
  await page.goto('/');
  await expect.poll(() => drawn(page)).toBe(true);
  const { plain, t } = await shown(page);
  expect(t).toBeNull();
  expect(requested.filter((url) => url.includes(`/vi/${SCHEDULE_VIDEO_ID}/`))).toEqual([plain]);
  expect(errors).toEqual([]);
});

test.describe('JS を切ったとき', () => {
  test.use({ javaScriptEnabled: false });

  test('予定のサムネイルは、クエリ無しの URL で描けている', async ({ page }) => {
    await serveThumbnails(page);
    await page.goto('/');
    await expect.poll(() => drawn(page)).toBe(true);
    expect((await shown(page)).t).toBeNull();
  });
});
