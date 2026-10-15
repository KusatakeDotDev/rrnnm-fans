import { expect, test } from '@playwright/test';

import { builtRoutes } from '../helpers/dist';

/**
 * 検索避けを外したこと（Issue rurino-nemo-fansite#31 の一般公開）が、全ページで戻っていないことを見る。
 *
 * 公開前は docs/CONCEPT.md §6「プレビュー版は検索避け必須」により、ここで「付いていること」を見ていた。
 * 解除のとき、このファイルは消さずに反転させた（docs/adr/0003-testing-and-ci.md「反転させる。消さない」）。
 *
 * 全ページを走査するので、後から足したページやページ側に書いた noindex も拾う。
 *
 * 応答ヘッダーは、静的ファイルの中身（tests/unit/search-blocking.test.ts）とは別に見る。「書いてある」と
 * 「効いている」は別。wrangler dev は本番と同じ workerd で public/_headers を適用し、`dev.host` が無いので
 * wrangler.jsonc の routes の最初（rrnnm.fans）をホストとして判定する（wrangler 4.145.0 の getInferredHost）。
 * つまり、ここで見るのは本番のホストに付くヘッダー。workers.dev に絞った noindex は付かないはず。
 */
for (const route of builtRoutes()) {
  test(`meta でも X-Robots-Tag でも、検索避けにしていない — ${route}`, async ({ page }) => {
    const response = await page.goto(route);

    // robots だけでなく googlebot・googlebot-news など個別のクローラ向けの名前も、
    // `none`（noindex, nofollow と同じ）も拾う。
    const blocking = await page
      .locator('meta[name][content]')
      .evaluateAll((metas) =>
        metas
          .filter(
            (m) =>
              /robots|bot/i.test(m.getAttribute('name') ?? '') &&
              /\b(noindex|nofollow|none)\b/i.test(m.getAttribute('content') ?? ''),
          )
          .map((m) => m.outerHTML),
      );
    expect(blocking).toEqual([]);

    expect(response?.headers()['x-robots-tag'], `${route} に X-Robots-Tag がある`).toBeUndefined();
  });
}
