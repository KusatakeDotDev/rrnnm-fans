import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { DIST, distTextFiles } from '../helpers/dist';
import { X_EMBEDS } from '../helpers/x-embed';

import { SKEB_WORKS } from '../../src/content/skeb';

test('Skeb — 本番OFFでは作品データと専用カードCSS・スクリプトを成果物に含めない', () => {
  const receipt = JSON.parse(readFileSync(`${DIST}.receipt.json`, 'utf8'));
  test.skip(receipt.showUnreleased === true, '未公開ONのビルド');
  expect(receipt.showUnreleased).toBe(false);
  for (const { rel, text } of distTextFiles()) {
    expect(text, rel).not.toContain('skeb.jp/@rurino_nemo/works/');
    expect(text, rel).not.toContain('x.com/rurino_nemo/status/');
    expect(text, rel).not.toMatch(/_works_[a-z0-9]+_\d+/);
    expect(text, rel).not.toContain('作品のタグ');
    expect(text, rel).not.toContain('data-skeb-');
  }
});

test('Skeb — ユーザー指定の17件を、ねもさん制作のボイスとして登録する', () => {
  expect(SKEB_WORKS).toHaveLength(17);
  expect(new Set(SKEB_WORKS.map((work) => work.id)).size).toBe(17);
  expect(SKEB_WORKS.map((work) => work.url)).toEqual(
    Array.from({ length: 17 }, (_, i) => `https://skeb.jp/@rurino_nemo/works/${i + 1}`),
  );
  for (const [index, work] of SKEB_WORKS.entries()) {
    expect(work.title).toBe(`ボイス作品 #${index + 1}`);
    expect(work.nemoRole).toBe('creator');
    expect(work.category).toBe('voice');
    expect(work.creator).toBe('瑠璃野ねも');
    expect(work.confidence).toBe('secondary');
    expect(work.availability).toBe('user-confirmed');
    expect(work.tags).toEqual([]);
    expect(work.sources).toEqual([{ kind: 'user-provided', url: work.url, provided: '2026-10-12' }]);
    expect(work).not.toHaveProperty('publishedAt');
    expect(work).not.toHaveProperty('audio');
    expect(work).not.toHaveProperty('script');
    if (work.deliveryPost) expect(work.deliveryPost.url).toMatch(/^https:\/\/x\.com\/rurino_nemo\/status\/\d+$/);
    if (work.youtube) expect(work.youtube).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);
  }
  // 納品のポストは、X の埋め込みを許すポストと同じ。片方にだけ足すと、埋め込めないリンクか、使わない許可が残る。
  expect(SKEB_WORKS.flatMap((work) => (work.deliveryPost ? [work.deliveryPost.url.split('/').pop()] : []))).toEqual(X_EMBEDS['/skeb/']!.posts);
});
