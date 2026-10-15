import { expect, test } from '@playwright/test';

import { builtRoutes } from '../helpers/dist';

/**
 * docs/DESIGN.md §6 / docs/adr/0001-tech-stack.md 要件2
 *   「JSを切っても主要コンテンツが読める構成。JSが要るのは検索UIとミニゲームだけ」
 *
 * Astro を選んだ理由そのものなので、フレームワークの既定に任せず毎回確かめる。
 * island を1個足した瞬間に破れる種類の仕様であり、レビューでは気付けない。
 */
test.describe('JS を切っても読める', () => {
  test.use({ javaScriptEnabled: false });

  for (const route of builtRoutes()) {
    test(`本文が読める — ${route}`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.ok(), `${route} が 200 で返っていない`).toBe(true);

      const bodyText = (await page.locator('body').innerText()).trim();
      expect(bodyText.length, 'JS 無しで表示されるテキストが空').toBeGreaterThan(0);
    });
  }
});

/**
 * docs/DESIGN.md §6「日本語主体。lang="ja"」
 */
for (const route of builtRoutes()) {
  test(`html[lang="ja"] — ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  });
}
