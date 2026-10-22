import { expect, test } from '@playwright/test';

for (const scenario of ['success', 'http-error', 'invalid-json', 'timeout', 'broken-image', 'unsafe-image'] as const) {
  test(scenario === 'timeout' ? '再生リストの名前の取得は、応答が無ければ時間で打ち切る' : `再生リストの oEmbed: ${scenario}`, async ({ page }) => {
    let requests = 0;
    let finished = 0;
    let failed = 0;
    const errors: string[] = [];
    const responseStatuses: number[] = [];
    page.on('response', (response) => {
      if (response.url().startsWith('https://www.youtube.com/oembed?')) responseStatuses.push(response.status());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfinished', (request) => {
      if (request.url().startsWith('https://www.youtube.com/oembed?')) finished++;
    });
    page.on('requestfailed', (request) => {
      if (request.url().startsWith('https://www.youtube.com/oembed?')) failed++;
    });
    await page.route('https://www.youtube.com/oembed?**', async route => {
      requests++;
      if (scenario === 'timeout') return; // fetch の AbortSignal で打ち切る。
      if (scenario === 'http-error') return route.fulfill({ status: 503, body: '' });
      if (scenario === 'invalid-json') return route.fulfill({ body: '{broken' });
      return route.fulfill({ json: {
        title: '固定の再生リスト名', provider_name: 'YouTube', thumbnail_width: 480, thumbnail_height: 360,
        thumbnail_url: scenario === 'unsafe-image' ? 'https://example.invalid/image.jpg' : 'https://i.ytimg.com/vi/fixture/hqdefault.jpg',
      } });
    });
    await page.route('https://i.ytimg.com/**', route => scenario === 'broken-image' ? route.abort() : route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"/>',
    }));
    if (scenario === 'timeout') {
      // fetch に signal を渡していることを本物の打ち切りで見たまま、5 秒の待ちだけを縮める（ADR-0027「再生リストの timeout のテストは、待ちだけを縮める」）。
      await page.addInitScript(() => {
        const timeout = AbortSignal.timeout.bind(AbortSignal);
        AbortSignal.timeout = (ms) => timeout(Math.min(ms, 50));
      });
    }
    // 狭い画面の畳みは、表紙を見ない場面に載せて、トップを開く回数を増やさない。
    const narrow = scenario === 'http-error';
    if (narrow) await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    const grid = page.locator('[data-playlists]');
    const titles = grid.locator('[data-playlists-title]');
    await grid.scrollIntoViewIfNeeded();
    const expectedRequests = await grid.locator('[data-playlists-item] [data-playlists-tile]').count();
    expect(expectedRequests).toBeGreaterThan(0);
    await expect.poll(() => requests).toBe(expectedRequests);
    await expect.poll(() => finished + failed).toBe(expectedRequests);
    if (scenario === 'timeout') expect(failed).toBe(expectedRequests);
    else expect(responseStatuses).toEqual(Array.from({ length: expectedRequests }, () => scenario === 'http-error' ? 503 : 200));
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const responseExpected = ['success', 'broken-image', 'unsafe-image'].includes(scenario);
    if (responseExpected) await expect(titles.first()).toHaveText('固定の再生リスト名');
    else {
      await expect(titles.first()).not.toHaveText('固定の再生リスト名');
      await expect(titles.first()).not.toBeEmpty();
    }
    const images = grid.locator('img');
    if (scenario === 'success') {
      expect(await images.count()).toBeGreaterThan(0);
      await expect.poll(() => images.first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 480)).toBe(true);
      await expect(images.first()).not.toHaveAttribute('data-loading');
    } else await expect(images).toHaveCount(0);
    const links = grid.locator('[data-playlists-tile]');
    expect(await links.count()).toBeGreaterThan(0);
    for (const link of await links.all()) await expect(link).toHaveAttribute('href', /^https:\/\/www.youtube.com\//);
    if (narrow) {
      await test.step('狭い画面では先頭の6枚に畳み、「すべて見る」を押すと全部を出して7枚目にフォーカスを移す', async () => {
        const items = grid.locator('[data-playlists-list] > li');
        expect(await items.count()).toBeGreaterThan(6);
        await expect(items.nth(5)).toBeVisible();
        await expect(items.nth(6)).toBeHidden();
        await grid.getByRole('button', { expanded: false }).click();
        await expect(items.filter({ visible: true })).toHaveCount(await items.count());
        const more = grid.locator('[data-playlists-more]');
        await expect(more).toBeHidden();
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        await expect(links.nth(6)).toBeFocused();
      });
    }
    expect(errors).toEqual([]);
  });
}

test('共通ブラウザ検査では YouTube の両ホストを名前解決で遮断する', async ({ page }) => {
  await page.goto('/');
  const urls = ['https://www.youtube.com/oembed?url=test', 'https://i.ytimg.com/vi/fixture/hqdefault.jpg'];
  for (const url of urls) {
    const failure = page.waitForEvent('requestfailed', (request) => request.url() === url);
    await page.evaluate((target) => {
      if (target.includes('i.ytimg.com')) {
        const image = new Image();
        image.src = target;
        document.body.append(image);
      } else {
        void fetch(target).catch(() => {});
      }
    }, url);
    expect((await failure).failure()?.errorText).toBe('net::ERR_NAME_NOT_RESOLVED');
  }
});
