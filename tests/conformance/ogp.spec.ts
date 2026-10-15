import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import sharp from 'sharp';

import { DIST, builtRoutes } from '../helpers/dist';

/**
 * docs/DESIGN.md §6「各ページに適切なOGPとタイトル。**検索から下層に直接来る前提**で組む」
 *
 * 「非公式」が入っているかは unofficial-labeling.spec.ts が見る。ここで見るのは、
 * **SNS に貼られたときにカードが出る形になっているか。** どれも、崩れても見た目には何も出ず、
 * 貼られて初めて気付く類いのもの。
 *   - og:url・og:image が絶対 URL。相対だと SNS は読めない
 *   - og:url がそのページ自身を指している。全ページがトップを指す、のような書き間違いを落とす
 *   - og:image が dist に実在し、og:image:width・height と実際の大きさが合っている
 *     （タグの値は src/layouts/og-image.ts、画像は scripts/generate-og-image.mjs が書いてコミットしたもの。
 *     回し忘れると片方だけ古くなる）
 *   - og:image のファイル名に日付が入っている。SNS は画像を URL ごとにキャッシュするので、
 *     差し替えのたびに名前を変えられる形にしておく（og-image.ts）
 *
 * 実際の SNS での見え方は見ない。公開前の本番は Cloudflare Access の中にあり（2026-10-06 時点）、
 * SNS からは取りに来られない。
 */
for (const route of builtRoutes()) {
  test(`OGP がカードの出る形で出ている — ${route}`, async ({ page }) => {
    await page.goto(route);

    const meta = async (key: string) => {
      const attr = key.startsWith('og:') ? 'property' : 'name';
      const tags = page.locator(`meta[${attr}="${key}"]`);
      await expect(tags, `${key} が1つでない`).toHaveCount(1);
      const content = await tags.getAttribute('content');
      expect(content?.trim(), `${key} が空`).toBeTruthy();
      return content!;
    };

    await meta('og:title');
    await meta('og:description');
    expect(await meta('og:type')).toBe('website');
    expect(await meta('twitter:card')).toBe('summary_large_image');

    // new URL を base 無しで呼ぶ。相対 URL なら throw して落ちる。
    const pageUrl = new URL(await meta('og:url'));
    const imageUrl = new URL(await meta('og:image'));
    expect(pageUrl.protocol).toBe('https:');
    // route は dist のファイル名から作るので、URL と次の2つが揃わない。揃えてから比べる。
    //   - 末尾の `/`。404 のように、dist では `404.html`、URL では `/404/` になるページがある
    //   - 文字の符号化。pathname は % で符号化されていて、route はファイル名のまま（日本語のルートで食い違う）
    const trimSlash = (p: string) => p.replace(/\/$/, '');
    expect(trimSlash(decodeURI(pageUrl.pathname))).toBe(trimSlash(route));
    expect(imageUrl.origin, 'og:image が og:url と別のホストを指している').toBe(pageUrl.origin);

    expect(imageUrl.pathname, 'og:image のファイル名に日付（.YYYYMMDD.png）が無い').toMatch(/\.\d{8}\.png$/);
    const imageFile = path.join(DIST, imageUrl.pathname);
    expect(existsSync(imageFile), `og:image の ${imageUrl.pathname} が dist に無い`).toBe(true);
    const { width, height } = await sharp(imageFile).metadata();
    expect(Number(await meta('og:image:width'))).toBe(width);
    expect(Number(await meta('og:image:height'))).toBe(height);
  });
}
