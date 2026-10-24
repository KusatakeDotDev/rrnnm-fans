import { defineConfig, mergeConfig } from 'vite-plus';

import base from './vitest.config';

/**
 * Stryker から回すとき専用の設定。テストの内容は vitest.config.ts と同じ。
 *
 * 違いはレポーターだけ。**Stryker はミュータントを倒すために意図的にテストを落とす**ので、
 * vitest の github-actions レポーターがそれを拾うと、成功したジョブの GitHub サマリーに
 * 「❌ 1 failure」が何十個も並ぶ。CIのサマリーが嘘をつく状態は、
 * 検査そのものへの信用を削る（→ docs/adr/0003-testing-and-ci.md §7）。
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      reporters: ['default'],
    },
  }),
);
