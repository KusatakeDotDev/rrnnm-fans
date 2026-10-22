import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import postcss from 'postcss';

import { builtPages, pageStyles } from '../helpers/dist';

/**
 * ビルドした各ページで、CSS のレイヤーが src/styles/layers.css の順に並ぶか
 * （ADR-0025「順の宣言は1か所に書き、ビルドしたページで確かめる」）。
 *
 * レイヤーの順は、名前が最初に出た順で決まる。その順は Astro が出す <head> の並びで決まり、ソースだけでは分からないので、
 * ビルドしたページの CSS を文書の順に読んで計算する。minify が書き方を変えても壊れないよう、文字列ではなく構文木で読む。
 */
function layerOrder(css: string[]): string[] {
  const names: string[] = [];
  for (const text of css) {
    postcss.parse(text).walkAtRules('layer', (rule) => {
      for (const name of rule.params.split(',').map((part) => part.trim())) {
        if (name && !names.includes(name)) names.push(name);
      }
    });
  }
  return names;
}

const DECLARED = layerOrder([readFileSync(new URL('../../src/styles/layers.css', import.meta.url), 'utf8')]);

test('layers.css に、順の宣言がある', () => {
  expect(DECLARED.length, 'layers.css から順を読めない').toBeGreaterThan(0);
});

for (const { route, file } of builtPages()) {
  test(`CSS のレイヤーが layers.css の順に並ぶ — ${route}`, () => {
    expect(layerOrder(pageStyles(file))).toEqual(DECLARED);
  });
}
