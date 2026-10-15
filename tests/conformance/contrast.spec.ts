import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { AXE_TAGS, THIRD_PARTY_EMBED } from '../helpers/axe';
import { builtRoutes } from '../helpers/dist';

/**
 * docs/DESIGN.md §6「ライト／ダーク両テーマでコントラスト AA」(Issue rurino-nemo-fansite#9)
 *   §4「地ごとに使える色が変わるので、人力チェックでは必ず漏れる」
 *
 * このファイルだけ playwright.config.ts で light / dark の2プロジェクトから回す。
 * emulateMedia ではなくプロジェクトを分けているのは、失敗したとき
 * **どちらのテーマで落ちたかがレポートの行名で分かる**ようにするため。
 *
 * 単体テスト（tests/unit/contrast.test.ts）との役割分担:
 *   - 単体 = パレットの数値が docs/DESIGN.md §4 の表どおりか
 *   - ここ = 実際に描画された組み合わせが AA を満たすか（トークンの使い方の間違いを捕まえる）
 *
 * **第三者の埋め込みの中は見ない。** axe は Playwright 経由だと cross-origin の
 * iframe の中まで降りていくが、**中は第三者の出力でこちらからは直せない**。
 * 直せないものを毎回赤くしても、本当に直すべき違反が埋もれるだけになる。
 *
 * X の埋め込み（src/pages/references.astro）は除外ではなく、そもそも読ませていない（playwright.config.ts の
 * BLOCK_EXTERNAL_EMBEDS）。ここで見るのは、埋め込みが出なかったときの表示（ポストへのリンク）になる。
 *
 * 範囲（AXE_TAGS）と除外（THIRD_PARTY_EMBED）は、コンポーネントの検査（.storybook/preview.ts）と同じ値を
 * tests/helpers/axe.ts から読む。
 */
// TODO(RRNNM-28): ダークモードが入ったら外す。今はダークのページが無く、ライトをもう一度見ているだけ（rurino-nemo-fansite#198）。
test.fixme(({ colorScheme }) => colorScheme === 'dark', 'ダークモード（RRNNM-28）がまだ無い');

for (const route of builtRoutes()) {
  test(`コントラストと WCAG A/AA — ${route}`, async ({ page }) => {
    await page.goto(route);

    const results = await new AxeBuilder({ page })
      .withTags(AXE_TAGS)
      .exclude(THIRD_PARTY_EMBED)
      .analyze();

    const violationMessages = results.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' / ')}`,
    );
    expect(violationMessages).toEqual([]);
  });
}
