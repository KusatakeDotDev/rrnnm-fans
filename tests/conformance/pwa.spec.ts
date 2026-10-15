import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // 起動位置の検査をYouTubeの応答時間に依存させない。
  await page.route(/^https:\/\/i\.ytimg\.com\//, async (route) => {
    const [width, height] = route.request().url().includes('/maxresdefault.jpg') ? [1280, 720] : [480, 360];
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`,
    });
  });
});

test('認証Cookieが必要なmanifestをブラウザが取得できる', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pwa-test-access', value: 'allowed', url: baseURL!, httpOnly: true }]);
  const cookies: string[] = [];
  await page.route('**/manifest.webmanifest', async (route) => {
    const cookie = (await route.request().allHeaders())['cookie'] ?? '';
    cookies.push(cookie);
    if (!cookie.includes('pwa-test-access=allowed')) {
      await route.fulfill({ status: 401, body: 'Authentication required' });
      return;
    }
    await route.continue();
  });
  await page.goto('/');
  // fetch() ではなく、ブラウザ自身のmanifest取得にCookieが付くことを確かめる。
  const session = await context.newCDPSession(page);
  const manifest = await session.send('Page.getAppManifest');
  expect(cookies).not.toHaveLength(0);
  expect(cookies.every((cookie) => cookie.includes('pwa-test-access=allowed'))).toBe(true);
  expect(manifest.errors).toEqual([]);
  expect(JSON.parse(manifest.data!).start_url).toBe('/#schedule');
});

test('ホーム画面の起動先とアイコンが配信される', async ({ page, request }) => {
  await page.goto('/');
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveCount(1);
  const response = await request.get((await manifestLink.getAttribute('href'))!);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: '/', start_url: '/#schedule', scope: '/', display: 'standalone', lang: 'ja',
  });
  expect(manifest.name).toMatch(/^非公式 /);
  expect(manifest.short_name).toBe('非公式 rrnnm');
  expect(manifest.theme_color).toBe(manifest.background_color);
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes).sort()).toEqual(['192x192', '512x512']);
  for (const icon of manifest.icons) {
    const size = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return `${img.naturalWidth}x${img.naturalHeight}`;
    }, icon.src);
    expect(size).toBe(icon.sizes);
  }
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 412, height: 915 }, { width: 1280, height: 800 }]) {
  test(`起動時と画像読み込み後に予定の見出しが隠れない（${viewport.width}px）`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let release!: () => void;
    const imagesReady = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/*', async (route) => {
      if (route.request().resourceType() === 'image') await imagesReady;
      await route.fallback();
    });
    try {
      await page.goto('/#schedule', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#schedule')).toBeInViewport();
      const before = (await page.locator('#schedule').boundingBox())!;
      // フラグメントへのスクロール補正が隠すレイアウト変動も検出する。
      const beforeDocumentY = await page.locator('#schedule').evaluate((el) => el.getBoundingClientRect().y + scrollY);
      expect(before.y).toBeGreaterThanOrEqual(32);
      expect(before.y + before.height).toBeLessThan(viewport.height);
      const header = (await page.locator('header').boundingBox())!;
      expect(header.y + header.height).toBeLessThanOrEqual(before.y);
      release();
      await page.waitForLoadState('load');
      await page.evaluate(() => document.fonts.ready);
      const after = (await page.locator('#schedule').boundingBox())!;
      const afterDocumentY = await page.locator('#schedule').evaluate((el) => el.getBoundingClientRect().y + scrollY);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(afterDocumentY - beforeDocumentY)).toBeLessThanOrEqual(2);
      await expect(page.getByRole('region', { name: '今週の配信予定' }).getByRole('link').first()).toBeInViewport();
    } finally {
      release();
    }
  });
}
