import { expect, test } from '@playwright/test';

import { builtRoutes } from '../helpers/dist';

/**
 * 全ページのレイアウト（src/layouts/Base.astro）の形。
 *
 * - ヘッダーと本文は同じ左右の線に揃う（src/styles/global.css の .container）
 * - フッターは画面の下端に付く。中身が短いページでも、フッターの下に地を残さない
 *
 * どちらも、body を縦の flex にした形が崩れると壊れる。flex をやめるとフッターが中身のすぐ下で止まり、
 * .container の width: 100% を消すと、flex の子のヘッダーが中身の幅に縮んで中央に寄る。
 * トップのヘッダーは畑の上に absolute で重ねていて flex の子ではないので、width: 100% を消しても縮まない。
 * それを捕まえるのは下層ページ（/about など）の回。
 * 見た目のことで、ほかの規約テストはヘッダー・フッターの中身しか見ないので、ここで位置を見る。
 *
 * 高さの単位（Base.astro の svh）は見ない。デスクトップの Chrome にはアドレスバーが無く、svh・dvh・vh が同じ値になる。
 * dist の CSS の文字列を見ても、コードを写すだけで動きは確かめられない。
 *
 * 2つを1つのテストにまとめているのは、ページを開く回数を減らすため（トップでは開くたびに畑の WebGL が立ち上がる）。
 */
const WIDTHS = [390, 1280];

for (const route of builtRoutes()) {
  for (const width of WIDTHS) {
    test(`レイアウト — ${route}（幅 ${width}px）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(route);

      await test.step('ヘッダーと本文が同じ左右の線に揃う', async () => {
        const header = await page.locator('body > header').boundingBox();
        const content = await page.locator('main > .container').boundingBox();
        expect(header).not.toBeNull();
        expect(content).not.toBeNull();
        expect(header!.x).toBeCloseTo(content!.x, 0);
        expect(header!.width).toBeCloseTo(content!.width, 0);
      });

      // どのページも中身が画面より短くなるよう、ビューポートを中身の高さより高くしてから見る。
      // ページの長さを書かずに済み、ページが増えても直さなくていい。
      await test.step('中身が短くても、フッターが画面の下端に付く', async () => {
        const contentHeight = await page.evaluate(async () => {
          await document.fonts.ready;
          return document.documentElement.scrollHeight;
        });
        await page.setViewportSize({ width, height: contentHeight + 400 });

        const { scrollHeight, viewport } = await page.evaluate(() => ({
          scrollHeight: document.documentElement.scrollHeight,
          viewport: window.innerHeight,
        }));
        expect(
          scrollHeight,
          'ビューポートを広げたあとに中身が伸び、画面に収まらなかった。ビューポートの高さについて伸びる中身（svh・vh の高さ）があれば、' +
            '余白を足しても収まらないので、その上限を見る。無ければ、足す余白（400）を増やす',
        ).toBeLessThanOrEqual(viewport);

        const footer = await page.locator('body > footer').boundingBox();
        expect(footer).not.toBeNull();
        expect(Math.abs(footer!.y + footer!.height - viewport)).toBeLessThan(1);
      });
    });
  }
}
