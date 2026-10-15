import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { DIST, distTextFiles } from '../helpers/dist';

import { BOOTH_GOODS } from '../../src/components/goods';

test('グッズ — 本番OFFでは商品・画像・運営方針の BOOTH の文・専用CSSを成果物に含めない', () => {
  const receipt = JSON.parse(readFileSync(`${DIST}.receipt.json`, 'utf8'));
  test.skip(receipt.showUnreleased === true, '未公開ONのビルド');
  expect(receipt.showUnreleased).toBe(false);
  for (const { rel, text } of distTextFiles()) {
    expect(text, rel).not.toContain('pximg.net');
    expect(text, rel).not.toContain('rurino-nemo.booth.pm/items/');
    expect(text, rel).not.toContain('BOOTH が OGP で提供している');
    expect(text, rel).not.toContain('フィジカルグッズ');
    expect(text, rel).not.toMatch(/\.goods\.astro-|class="goods[\s"]/);
    for (const item of BOOTH_GOODS) expect(text, rel).not.toContain(item.name);
  }
});
