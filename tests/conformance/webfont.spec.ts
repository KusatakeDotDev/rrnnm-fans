import { expect, test } from '@playwright/test';

import { builtRoutes } from '../helpers/dist';

/**
 * ADR-0024 の決定 — 本文も見出しも、Zen Maru Gothic の webfont で描く。
 *
 * 本文のスタック（tokens.css の --font-sans）の先頭のファミリが、ページで実際に読まれたかを見る。
 * 名前の書き違い・fonts.css の読み込み忘れ・ビルドでチャンクの URL が壊れる、のどれでも、ページは端末の書体で
 * そのまま描かれ、見た目でしか気付けない。
 *
 * ファミリ名はテストに書かず、body の計算後の font-family の先頭を使う。量の上限は性能予算
 * （tests/artifact/performance-budget.spec.ts）が見て、ブラウザが実際に読んだ量は下の線が見る。
 */

const KiB = 1024;

const kib = (bytes: number): string => `${(bytes / KiB).toFixed(1)} KiB`;

/**
 * ページを初めて開いたときに、ブラウザが読む woff2（生のバイト数）。線の引き方は ADR-0006「線の引き方」。
 * どの字をどの太さの面で描くかはブラウザが決めるので、dist からは上限（performance-budget.spec.ts の routeWebfont）しか出せない。
 */
const LOADED_WOFF2 = 800 * KiB;

/**
 * 名指しで線を替えるページ。
 *   - /skeb/（未公開）: 作品のセリフや題を 700 で描き、その字が多いので、700 のチャンクを多く読む
 */
const LOADED_WOFF2_BY_ROUTE: Record<string, number> = {
  '/skeb/': 1350 * KiB,
};

for (const route of builtRoutes()) {
  const budget = LOADED_WOFF2_BY_ROUTE[route] ?? LOADED_WOFF2;

  // webfont を読ませて開くと、チャンクを数十本読んで遅い（ADR-0024「払うもの」）。1ルートにつき1回だけ開き、両方を見る。
  test(`本文の先頭の書体の webfont が読まれ、woff2 が ${kib(budget)} 以内 — ${route}`, async ({ page }) => {
    const woff2: Promise<number>[] = [];
    page.on('requestfinished', (request) => {
      if (new URL(request.url()).pathname.endsWith('.woff2')) woff2.push(request.sizes().then((sizes) => sizes.responseBodySize));
    });
    await page.goto(route);

    const family = await page.evaluate(() =>
      getComputedStyle(document.body).fontFamily.split(',')[0]!.trim().replace(/^["']|["']$/g, ''),
    );
    /** その状態の面の太さ（`font-weight` の記述子）を、面ごとに1つ返す。 */
    const weights = (status: FontFaceLoadStatus) =>
      page.evaluate(
        ([name, wanted]) =>
          [...document.fonts]
            .filter((face) => face.family.replace(/^["']|["']$/g, '') === name && face.status === wanted)
            .map((face) => face.weight),
        [family, status] as const,
      );

    // @font-face の CSS は描画を止めずに後から当たる（Base.astro）ので、document.fonts.ready だけでは、まだ面が無いうちに終わる。
    await expect.poll(async () => (await weights('loaded')).length, { message: `${family} の面が1つも読まれていない` }).toBeGreaterThan(0);
    await page.evaluate(() => document.fonts.ready);

    // チャンクが 404 などで読めないと、その字だけが端末の書体に落ちる。読んだ量も見たいので、ここでは止めない。
    expect.soft((await weights('error')).length, `${family} の面のうち、読めなかったもの`).toBe(0);

    const loaded = await weights('loaded');
    // 応答の終わりは、document.fonts.ready より後に届くことがある。面1つにつき1本読むので、読んだ面の数だけ届くのを待つ。
    await expect.poll(() => woff2.length, { message: '読んだ面の数だけ woff2 の応答が届かない' }).toBeGreaterThanOrEqual(loaded.length);
    const bytes = (await Promise.all(woff2)).reduce((sum, b) => sum + b, 0);
    const byWeight = [...new Set(loaded)]
      .sort()
      .map((weight) => `${weight}: ${loaded.filter((w) => w === weight).length} 面`)
      .join(' / ');

    expect(bytes, `woff2 ${woff2.length} 本 ${kib(bytes)}（${byWeight}）`).toBeLessThanOrEqual(budget);
  });
}
