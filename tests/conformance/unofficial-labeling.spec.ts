import { expect, test } from '@playwright/test';

import { builtRoutes } from '../helpers/dist';

/**
 * docs/CONCEPT.md §2「非公式ポリシー」/ §7 公開前チェックリスト
 *   「サイト名に『非公式』を含める。<title>・OGP・ヘッダー・フッターの4箇所すべてに出す。
 *     トップだけでは足りない（検索から下層ページに直接来る人が多いため）」
 *
 * 「4箇所すべて」「全ページ」が仕様なので、**全ルート × 4箇所**で回す。
 * OGP は src/layouts/Base.astro が全ページに出す。カードが出る形になっているか（絶対 URL・画像の実在）は
 * ogp.spec.ts が見る。ここで見るのは「非公式」が入っているかだけ。
 */
const UNOFFICIAL = '非公式';

for (const route of builtRoutes()) {
  test.describe(`非公式表記4箇所 — ${route}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(route);
    });

    test('1/4 <title> に「非公式」が入っている', async ({ page }) => {
      expect(await page.title()).toContain(UNOFFICIAL);
    });

    // 仕様の言う「サイト名」は og:site_name。og:title も見るのは、カードによっては
    // og:site_name を出さず og:title だけを出すため（Issue rurino-nemo-fansite#7 も og:title を挙げている）。
    // 画像の中の「非公式」（ロゴのラベル）は、絵なので見ない。
    test('2/4 OGP（og:site_name・og:title）に「非公式」が入っている', async ({ page }) => {
      for (const property of ['og:site_name', 'og:title']) {
        await expect(page.locator(`meta[property="${property}"]`)).toHaveAttribute('content', new RegExp(UNOFFICIAL));
      }
    });

    // ヘッダーとフッターは Base.astro が全ページに置く。ページ側には書かない
    // （書くと、後から足したページで漏れる）。
    // ヘッダーの「非公式」はロゴ画像の中にある（SiteHeader.tsx）。文字としては alt に入るので、
    // 見えている画像の alt も数える。toContainText は alt を見ない。
    test('3/4 ヘッダーに「非公式」が出ている', async ({ page }) => {
      const header = page.locator('body > header, header[role="banner"]');
      const shown = await header.evaluate((el) =>
        [
          el.textContent ?? '',
          ...[...el.querySelectorAll('img')].filter((img) => img.checkVisibility()).map((img) => img.alt),
        ].join(' '),
      );
      expect(shown).toContain(UNOFFICIAL);
    });

    test('4/4 フッターに「非公式」が出ている', async ({ page }) => {
      await expect(page.locator('body > footer, footer[role="contentinfo"]')).toContainText(UNOFFICIAL);
    });

    /**
     * docs/CONCEPT.md §7「『本人公認』『本人からOKをもらいました』と読める表記が
     * サイト上・SNS上のどこにも無い」
     *
     * 弾くのは公認を名乗る語だけ。「許可をいただいています」などは弾かない。本人以外（購入した素材の作者など）の
     * 許可を書くことがありうる。
     *
     * 本文のほかに、`<meta>` の中身も見る。SNS のカードには、本文ではなく description や og:* の文が出る。
     */
    test('「公認」を名乗る表記が出ていない', async ({ page }) => {
      const bodyText = await page.locator('body').innerText();
      const metaText = await page
        .locator('meta[content]')
        .evaluateAll((metas) => metas.map((meta) => meta.getAttribute('content')).join('\n'));
      expect(`${bodyText}\n${metaText}`).not.toMatch(/公認|オフィシャルサイト|本人からOK/);
    });
  });
}
