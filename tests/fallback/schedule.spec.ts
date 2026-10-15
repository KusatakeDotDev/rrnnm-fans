import { expect, test } from '@playwright/test';
import { OFFICIAL } from '../../src/components/official';
import { SCHEDULE_VIDEO_ID } from '../../src/components/schedule';

const scenario = process.env['TEST_BUILD_SCENARIO'];
test('固定応答から期待した予定表示になり、壊れた画像を残さない', async ({ page }) => {
  await page.route('https://i.ytimg.com/**', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"/>',
  }));
  await page.goto('/');
  const img = page.locator(`img[src*="/vi/${SCHEDULE_VIDEO_ID}/"]`);
  if (scenario === 'no-maxres') {
    await expect(img).toHaveAttribute('src', /\/hqdefault\.jpg/);
    await expect(img).toHaveAttribute('width', '480');
    await expect(img).toHaveAttribute('height', '360');
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth === 480)).toBe(true);
  } else {
    const link = page.getByRole('link', { name: '最新の配信スケジュールを見る', exact: false });
    await expect(link).toHaveAttribute('href', OFFICIAL.youtube);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(img).toHaveCount(0);
    await expect(page.locator('head [data-schedule-thumbnail]')).toHaveCount(0);
  }
});
