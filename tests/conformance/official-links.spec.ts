import { expect, test } from '@playwright/test';

import { OFFICIAL } from '../../src/components/official';
import { builtRoutes } from '../helpers/dist';

/**
 * docs/CONCEPT.md §4 柱9「ファンサイトの本分は公式への送客。目立つ位置に、常に」/
 * §7 公開前チェックリスト「公式チャンネル・公式Xへの導線がトップから1クリック」
 *
 * チェックリストの文言はトップだけだが、**全ルートで回す。** 検索から下層ページに
 * 直接来る人が多いのは非公式表記と同じ（unofficial-labeling.spec.ts）。
 * フッターは Base.astro が全ページに置くので、ページが増えてもこのテストは直さなくていい。
 *
 * 「1クリック」は**そのページに公式への `<a>` がそのままあり、見えている**こととして確かめる。
 * 公式のアカウントそのものではなく中継ページ（/links など）を挟むと、1クリックではなくなる。
 */
const ACCOUNTS = [
  ['YouTube', OFFICIAL.youtube],
  ['X', OFFICIAL.x],
  ['マシュマロ', OFFICIAL.marshmallow],
  ['BOOTH', OFFICIAL.booth],
] as const;

for (const route of builtRoutes()) {
  test.describe(`公式への導線 — ${route}`, () => {
    // アイコンだけだと、このサイト自身の SNS に見える。誰のアカウントかを文字で言う。
    test('フッターに「瑠璃野ねも 公式アカウント」と出ている', async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('body > footer')).toContainText('瑠璃野ねも 公式アカウント');
    });

    for (const [name, href] of ACCOUNTS) {
      test(`フッターから ${name} へ1クリック`, async ({ page }) => {
        await page.goto(route);
        const link = page.locator(`body > footer a[href="${href}"]`);
        await expect(link).toHaveCount(1);
        await expect(link).toBeVisible();
        // アイコンだけのリンクなので、名前は画像の alt から来る。読み上げで何と言われるかを見る。
        await expect(link).toHaveAccessibleName(new RegExp(`^${name}`));

        // 名前は alt から来るので、画像のパスを間違えて 404 になっても上は通る。
        // 実際に描ける画像が届いていることを見る。
        const icon = link.locator('img');
        await icon.scrollIntoViewIfNeeded();
        await expect
          .poll(() => icon.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
          .toBe(true);
      });
    }
  });
}
