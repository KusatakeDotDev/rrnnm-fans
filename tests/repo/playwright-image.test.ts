import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vite-plus/test';

/**
 * CI と Release が使う Playwright の Docker イメージのタグが、
 * pnpm-lock.yaml で決まった Playwright のバージョンと同じかを見る（rurino-nemo-fansite#153）。
 *
 * イメージに入っているのは、そのバージョンの Playwright が使うブラウザーだけ。ずれると、Playwright がブラウザーを
 * 見つけられず、CI のコンポーネントのテストと規約テストが落ちる（Playwright のドキュメント「Docker」）。
 * Dependabot は Playwright（npm）を上げるが、イメージのタグは上げないので、上げた PR はここで落ちる。
 * 同じ PR で ci.yml と release.yml のタグを直す。
 *
 * 見るのは pnpm-workspace.yaml の catalog の範囲（^1.63.0）ではなく、ロックファイルで決まった実際のバージョン。
 */

// ほかの単体テスト（search-blocking.test.ts など）と同じ形。tests/helpers にまとめるなら、それらと一緒にする。
const read = (relPath: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relPath}`, import.meta.url)), 'utf8');

const WORKFLOWS = ['ci.yml', 'release.yml'] as const;

const lock = read('pnpm-lock.yaml');

// ブラウザーのバージョンを決めるのは playwright-core。ほかの2つはそれに合わせて上がるが、どれか1つだけがずれても落とす。
const PACKAGES = ['playwright', 'playwright-core', '@playwright/test'] as const;

/**
 * ロックファイルの packages・snapshots のキー（`  playwright@1.63.0:`・`  '@playwright/test@1.63.0':`）のバージョン。
 * 2つ以上あれば全部を返す。どの依存がどちらを読むかはロックファイルからは決めきれないので、イメージと違うものが
 * 1つでも入ったら落として、人に見てもらう。
 */
function lockVersions(name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const key = new RegExp(`^ {2}'?${escaped}@([^'(:\\s]+)`, 'gm');
  return [...new Set([...lock.matchAll(key)].map((m) => m[1]))];
}

describe.each(WORKFLOWS)('%s のイメージは、ロックファイルの Playwright と同じバージョン', (workflow) => {
  const imageVersions = [...read(`.github/workflows/${workflow}`).matchAll(
    /^\s*image:\s*["']?mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)(?:[-@"'\s]|$)/gm,
  )].map((match) => match[1]);

  it('Playwright のイメージが1件ある', () => {
    expect(imageVersions).toHaveLength(1);
  });

  it.each(PACKAGES)('ロックファイルの %s のバージョンが、イメージのタグと同じ', (name) => {
    expect(
      lockVersions(name),
      `${workflow} の Playwright のイメージのタグを、ロックファイルの ${name} と同じバージョンにする`,
    ).toEqual([...new Set(imageVersions)]);
  });
});
