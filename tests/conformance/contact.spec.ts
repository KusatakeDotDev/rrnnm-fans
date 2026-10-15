import { expect, test } from '@playwright/test';

import { OFFICIAL } from '../../src/components/official';
import { builtRoutes } from '../helpers/dist';

/**
 * docs/CONCEPT.md §2「削除・訂正の窓口を用意する」/ §7 公開前チェックリスト
 *   「`/about` に削除・訂正の連絡先があり、全ページのフッターの「お問い合わせ」からそこへ届く」
 *
 * 窓口は制作者の X（src/components/contact.ts）。連絡先を書くのは /about だけで、フッター（SiteFooter.tsx）は
 * 「お問い合わせ」のリンクでそこへ飛ばす。ハンドルはここに書き写さない。
 * /about のルートも書かない（docs/adr/0003-testing-and-ci.md §2「層2 — ルートを列挙しない」）。
 * 各ページのフッターのリンクをたどり、飛んだ先の見出しの節を見る。
 * 見るのは、その節に、X へのリンクと、DM で受けることと、
 * 本人・関係者の申し出には無条件で応じる旨（§2）があること。
 * 相手が DM を受け取れる設定かはサイトの外の話なので、人が見る（§7）。
 */
for (const route of builtRoutes()) {
  test(`フッターから削除・訂正の連絡先へ届く — ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.locator('body > footer').getByRole('link', { name: 'お問い合わせ', exact: true }).click();

    // 飛んだ先の見出し（:target）を持つ節。
    const contact = page.locator('section:has(> :target)');
    await expect(contact).toHaveCount(1);
    await expect(contact).toContainText('削除・訂正');
    await expect(contact).toContainText('DM');
    await expect(contact).toContainText('理由を問わず応じます');

    const link = contact.getByRole('link');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /^https:\/\/x\.com\/[^/]+$/);
    // 制作者の X と本人の X を取り違えていないこと（上の正規表現は本人の X も通す）。
    await expect(link).not.toHaveAttribute('href', OFFICIAL.x);
  });
}
