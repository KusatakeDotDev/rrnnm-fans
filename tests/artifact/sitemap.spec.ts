import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { builtRoutes, DIST } from '../helpers/dist';

/**
 * サイトマップ（@astrojs/sitemap が書き出す。astro.config.mjs）に、ビルドしたページがちょうど載っていること。
 *
 * どれも、崩れても見た目には何も出ず、Google Search Console で初めて気付く類いのもの。
 *   - robots.txt の `Sitemap:` が、dist に実在するファイルを指している。インテグレーションのバージョンアップで
 *     出力の名前が変わると、robots.txt と Search Console に出した URL だけが古くなる
 *   - サイトマップの URL が、ビルドしたページと過不足なく一致する。後から足したページ（`/play/<slug>` など）の
 *     載せ忘れも、`filter` などで消したページも拾う
 *   - どの URL も、robots.txt の `Sitemap:` と同じオリジン。astro.config.mjs の `site` と public/robots.txt の
 *     片方だけを変えたときに落ちる
 *
 * 載ったページが noindex でないことは、ここでは見ない。noindex は全ページで禁じていて、
 * tests/conformance/noindex.spec.ts が落とす。
 */
const read = (urlPath: string) => readFileSync(path.join(DIST, urlPath), 'utf8');

/**
 * XML があらかじめ決めている5つの文字参照を戻す。サイトマップは `<loc>` の URL の `&`・`<`・`>` を `&amp;` などにして書く
 * （sitemap 9.0.1 の `text()`）。数値の文字参照（`&#38;` など）は書かないので戻さない。書くようになったら、テストが落ちる側に出る。
 */
const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => XML_ENTITIES[name]!);
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => unescapeXml(m[1]!.trim()));

/**
 * インテグレーションが載せないページ。@astrojs/sitemap はエラーページ（404・500）を除く（STATUS_CODE_PAGES）。
 * i18n のロケール付きのエラーページ（`/<locale>/404`）も除くが、i18n を使っていないので写していない。
 * ほかに載せない HTML（public/ に置いた静的な HTML など）ができたときも、ここに足す。
 * どれも、写し漏れはテストが落ちる側に出る（載せ忘れを見逃す側には出ない）。
 */
const STATUS_CODE_ROUTE = /^\/(404|500)\/?$/;

test('robots.txt の Sitemap が指すサイトマップに、ビルドしたページがちょうど載っている', () => {
  // 1行の中だけを見る（`\s*` だと、値が空の行で次の行の頭を値として拾う）。
  const values = [...read('robots.txt').matchAll(/^Sitemap:[ \t]*(\S*)[ \t]*$/gim)].map((m) => m[1]!);
  expect(values, 'robots.txt の Sitemap が1つでない').toHaveLength(1);
  expect(values[0], 'robots.txt の Sitemap が空').not.toBe('');
  const index = new URL(values[0]!);
  const origin = index.origin;

  const indexFile = decodeURI(index.pathname);
  expect(existsSync(path.join(DIST, indexFile)), `robots.txt の Sitemap の ${indexFile} が dist に無い`).toBe(true);

  // サイトマップインデックスが指す、URL を並べたファイル（ページが少ないうちは sitemap-0.xml の1つ）。
  // 読むのはパスだけなので、オリジンはここで見る。ページの URL のオリジンは、最後の toEqual が見る。
  const urlsets = locs(read(indexFile)).map((loc) => new URL(loc));
  expect(urlsets.length, 'サイトマップインデックスが何も指していない').toBeGreaterThan(0);
  const listed = urlsets.flatMap((urlset) => {
    expect(urlset.origin, `${urlset.href} が robots.txt の Sitemap と別のホスト`).toBe(origin);
    const urlsetFile = decodeURI(urlset.pathname);
    expect(existsSync(path.join(DIST, urlsetFile)), `サイトマップインデックスが指す ${urlsetFile} が dist に無い`).toBe(true);
    return locs(read(urlsetFile));
  });

  const expected = builtRoutes()
    .filter((route) => !STATUS_CODE_ROUTE.test(route))
    .map((route) => new URL(route, origin).href);
  expect(listed.sort()).toEqual(expected.sort());
});
