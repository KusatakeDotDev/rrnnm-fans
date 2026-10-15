import { expect, test } from '@playwright/test';

import { builtRoutes } from '../helpers/dist';

/**
 * playwright.config.ts の BLOCK_EXTERNAL_EMBEDS が、BOOTH の商品の画像（booth.pximg.net）にも効いていることを見る。
 *
 * 止めるホストは設定に文字で書いてあり、グッズのページの画像の URL（ビルドのときに商品ページの OGP から取る。
 * src/components/goodsData.ts）とはつながっていない。止める側を書き換えたり消したりしても誰も気付かず、
 * 規約テストが BOOTH の画像を読む状態に黙って戻り、/goods/ を開くテストが画像の配信の速さに左右される。
 * そこで、規約テストのブラウザで /goods/ を開いたとき、ページに画像があることと、booth.pximg.net から
 * 何も読めていないことを見る（X の埋め込みの tests/conformance/x-embed.spec.ts と同じ形）。
 * 画像がどれも booth.pximg.net のものであることは、tests/artifact/build-output.spec.ts が見る。
 *
 * 通信が止むまで（networkidle）待つ。数えるのは、booth.pximg.net から読み終えたもの（requestfinished）。
 * 止めたホストへの読み込みは失敗するので数えない。
 */
test('規約テストでは BOOTH の商品の画像を読まない — /goods/', async ({ page }) => {
  if (!builtRoutes().includes('/goods/')) {
    expect((await page.goto('/goods/'))?.status()).toBe(404);
    return;
  }
  const loaded: string[] = [];
  page.on('requestfinished', (request) => {
    if (new URL(request.url()).hostname === 'booth.pximg.net') loaded.push(request.url());
  });

  await page.goto('/goods/', { waitUntil: 'networkidle' });

  const sources = await page.locator('.goods img').evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).src));
  expect(sources.length, 'グッズのページに画像が無い。ビルドが BOOTH から取れていないと、この検査は空振りする').toBeGreaterThan(0);
  expect(loaded, 'booth.pximg.net から読めたもの').toEqual([]);
});
