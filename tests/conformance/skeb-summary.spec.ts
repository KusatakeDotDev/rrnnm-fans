import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

import { SKEB_WORKS } from '../../src/content/skeb';

// Only the shared production component is built with synthetic inputs. This separate
// output never changes the tracked JSON, the site's dist, or production routes.
test('Skeb approved and fallback cards render without JS at narrow and wide widths', async ({ browser }) => {
  test.setTimeout(120_000);
  const dir = await mkdtemp(join(tmpdir(), 'skeb-render-'));
  try {
    // A fresh process keeps React's production renderer separate from the test runner.
    await promisify(execFile)(process.execPath, [resolve('tests/fixtures/skeb-render/build.mjs'), dir], {
      env: { ...process.env, NODE_ENV: 'production' }, timeout: 90_000,
    });
    const html = await readFile(join(dir, 'dist/index.html'), 'utf8');
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.route('**/*', (route) => route.abort());
      const textHeights: number[] = [];
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(html);
        const cards = page.locator('[data-skeb-list] > li');
        await expect(cards).toHaveCount(17);
        for (let i = 0; i < 17; i++) {
          await expect(cards.nth(i).getByRole('heading', { level: 3 })).toHaveText(`ボイス作品 #${i + 1}`);
          await expect(cards.nth(i).getByRole('link', { name: /^Skeb で聴く/ })).toHaveAttribute('href', `https://skeb.jp/@rurino_nemo/works/${i + 1}`);
        }
        await expect(cards.first().getByText('合成データの見出し', { exact: true })).toBeVisible();
        await expect(cards.nth(1).getByText('タグなしの合成見出し', { exact: true })).toBeVisible();
        // カードには、お題・セリフの見出しの文字も出典も書かない。
        for (const label of ['お題', '提供資料のセリフ', '作品中のセリフ', '出典', '関連する作品ページ']) {
          await expect(cards.first()).not.toContainText(label);
          await expect(cards.nth(1)).not.toContainText(label);
        }
        await expect(cards.first().locator('blockquote')).not.toHaveAttribute('cite');
        await expect(cards.nth(1).locator('blockquote')).toHaveAttribute('cite', 'https://skeb.jp/@rurino_nemo/works/2');
        const notes = page.locator('footer');
        await expect(notes).toContainText('セリフの出典：運営者提供資料（2026-10-13 資料受領）、Skeb の作品ページ（2026-10-13 確認）');
        await expect(notes).toContainText('原音との照合を行っていません');
        await expect(notes.getByRole('link')).toHaveCount(0);
        await expect(page.getByRole('searchbox')).toHaveCount(0);
        await expect(page.getByRole('button')).toHaveCount(0);
        await expect(page.getByRole('combobox')).toHaveCount(0);
        await expect(cards.first()).not.toContainText('依頼文の自動要約');
        await expect(cards.first().locator('blockquote')).toHaveText('架空の「引用」&"セリフ"の表示テストです。'.repeat(3));
        await expect(cards.first().locator('blockquote > *')).toHaveCount(0);
        await expect(cards.first().getByRole('list', { name: '作品のタグ' }).getByRole('listitem')).toHaveText(['合成タグ', '表示確認']);
        await expect(cards.nth(1).getByRole('list')).toHaveCount(0);
        for (let i = 2; i < 17; i++) {
          const work = SKEB_WORKS[i]!;
          await expect(cards.nth(i).getByRole('link')).toHaveCount(1 + (work.deliveryPost ? 1 : 0) + (work.youtube ? 1 : 0));
          await expect(cards.nth(i).locator('blockquote')).toHaveCount(0);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        expect(await cards.first().evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        textHeights.push((await cards.first().locator('blockquote').boundingBox())!.height);
      }
      // Narrow screens wrap the complete text into more lines instead of clipping it.
      expect(textHeights[0]).toBeGreaterThan(textHeights[2]);
    } finally { await context.close(); }
    const accessible = await browser.newContext();
    try {
      const page = await accessible.newPage();
      await page.route('**/*', (route) => route.abort());
      await page.setContent(html);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally { await accessible.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
