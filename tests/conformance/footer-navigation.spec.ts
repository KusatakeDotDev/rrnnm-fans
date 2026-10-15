import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { builtRoutes } from '../helpers/dist';

for (const width of [320, 390, 1280]) {
  test(`footer groups built pages and accessible external links at ${width}px`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width, height: 900 } });
    try {
      const page = await context.newPage();
      await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto('/about/');
      const footer = page.locator('body > footer');
      const internal = footer.getByRole('list', { name: 'このサイト', exact: true }).getByRole('link');
      const hrefs = await internal.evaluateAll((links) => links.map((link) => link.getAttribute('href')!));
      const listedRoutes = ['/', '/about/', '/references/', ...['/skeb/', '/goods/'].filter((route) => builtRoutes().includes(route))].sort();
      expect(hrefs.filter((href) => !href.includes('#')).sort()).toEqual(listedRoutes);
      expect(builtRoutes()).toEqual(expect.arrayContaining(listedRoutes));
      expect(hrefs).toContain('/about/#contact');
      const external = footer.getByRole('list', { name: '瑠璃野ねも 公式アカウント', exact: true }).getByRole('link');
      await expect(external).toHaveCount(4);
      await expect(footer).toContainText('外部サイト・新しいタブで開きます');
      for (const link of await external.all()) {
        await expect(link).toHaveAccessibleName(/外部サイトを新しいタブで開く/);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      }
      const links = footer.getByRole('link');
      await links.first().focus();
      for (let i = 0; i < await links.count(); i++) {
        await expect(links.nth(i)).toBeFocused();
        expect((await links.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect((await links.nth(i).boundingBox())!.width).toBeGreaterThanOrEqual(44);
        if (i > 0) expect(await links.nth(i).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
        await page.keyboard.press('Tab');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    } finally { await context.close(); }
  });
}

test('footer passes automated accessibility checks', async ({ page }) => {
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/about/');
  expect((await new AxeBuilder({ page }).include('body > footer').analyze()).violations).toEqual([]);
});
