import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { AXE_TAGS, THIRD_PARTY_EMBED } from '../helpers/axe';
import { builtRoutes } from '../helpers/dist';
import { X_EMBED_PAGES, X_EMBEDS, X_HOST } from '../helpers/x-embed';

/**
 * docs/adr/0014-x-embed-reference-materials.md の決定
 *
 * X の埋め込みは、推し活の資料のページ（/references/）で、ぴよ汰。様が自分で公開したポストに、Skeb のページ（/skeb/）で、
 * ご本人の納品のポストにだけ使う（docs/adr/0022-x-embed-skeb-delivery-posts.md の決定）。
 * ページが持つのはポストへのリンク（`data-x-post` の中）だけで、埋め込みのコードは、ブラウザで X の oEmbed から取って
 * 差し込む（src/pages/references.astro・src/unreleased/skeb.astro）。外部スクリプトの許可ホストと、widgets.js を読むページ、JS の中身は
 * tests/artifact/build-output.spec.ts が見る。ここでは、どの要素がどのポストを指すかを、**ブラウザが組み立てた DOM** で見る。
 * HTML を正規表現で読むと、文字参照（`&#45;` など）や属性の書き方で、ブラウザと違う読み方になるため。
 *
 * どのページも X を止めて開く（playwright.config.ts の BLOCK_EXTERNAL_EMBEDS）。oEmbed も widgets.js も読めないので、
 * こちらの HTML（とページのスクリプトが load までに足したもの）を見ることになる。差し込む動きは、下の page.route の検査が見る。
 *
 * 許すページとポスト（ID で許す理由）と、この検査が防ぐ範囲は tests/helpers/x-embed.ts。
 */

for (const route of builtRoutes()) {
  test(`X の埋め込みは、許したページの、許したポストだけ — ${route}`, async ({ page }) => {
    await page.goto(route);

    const found = await page.evaluate((xHost) => {
      const statusId = (href: string) => /\/status(?:es)?\/(\d+)/i.exec(href)?.[1];
      return {
        // widgets.js は class で埋め込みを見つける（ポストの twitter-tweet のほか、タイムラインなども）。こちらの HTML には書かない。
        // 埋め込みのコードは oEmbed から差し込むもので、ここでは X を止めているので入らない。
        widgets: [...document.querySelectorAll('[class*="twitter-"]')].flatMap((el) =>
          [...el.classList].filter((name) => name.startsWith('twitter-')).map((name) => `${el.localName}.${name}`),
        ),
        // 埋め込みの置き場所ごとの、ポストへのリンクの ID（ポストの URL でないリンクは ''）。
        boxes: [...document.querySelectorAll('[data-x-post]')].map((box) =>
          [...box.querySelectorAll('a[href]')].map((a) => statusId(a.getAttribute('href') ?? '') ?? ''),
        ),
        tweetIds: [...document.querySelectorAll('[data-tweet-id]')].map((el) => el.getAttribute('data-tweet-id') ?? ''),
        // ポストの ID は、どの要素のどの属性に書いたものも数える（href・cite・SVG の a など）。値は DOM が文字参照を解いたもの。
        attrIds: [...document.querySelectorAll('*')].flatMap((el) =>
          [...el.attributes].flatMap((attr) => statusId(attr.value) ?? []),
        ),
        // X のホストから直に読むもの。widgets.js を通さずに X の iframe を置く形（埋め込みのコードを作るほかのツールが出す。
        // ポストの ID が `?id=` に入り、class も `/status/` も無いので、上のどれにも当たらない）と、pbs.twimg.com の画像を
        // 直に読む形（転載。src/pages/references.astro）。script は見ない（build-output.spec.ts の許可ホストと
        // widgets.js を読むページの検査が見る）。X は止めてあり widgets.js は何も出さないので、どのページにも1つも無いはず。
        // 読めない URL はブラウザも読みに行かないので飛ばす。
        direct: [...document.querySelectorAll(':not(script)[src], [srcset], object[data], video[poster]')].flatMap((el) => {
          const values = [
            el.getAttribute('src'),
            el.getAttribute('data'),
            el.getAttribute('poster'),
            ...(el.getAttribute('srcset') ?? '').split(',').map((candidate) => candidate.trim().split(/\s+/)[0]),
          ].filter((value): value is string => typeof value === 'string' && value !== '');
          return values.flatMap((value) => {
            try {
              return new RegExp(xHost.source, xHost.flags).test(new URL(value, location.href).hostname)
                ? [`${el.localName}: ${value}`]
                : [];
            } catch {
              return [];
            }
          });
        }),
      };
    }, { source: X_HOST.source, flags: X_HOST.flags });

    expect(found.direct, 'X のホストから直に読むもの').toEqual([]);
    expect(found.widgets, 'こちらの HTML に書いた X の埋め込みのコード').toEqual([]);

    if (!X_EMBED_PAGES.includes(route)) {
      expect(found.boxes, '埋め込みの置き場所（data-x-post）').toEqual([]);
      expect(found.tweetIds, 'data-tweet-id').toEqual([]);
      return;
    }

    expect(found.boxes.length, '埋め込みの置き場所が0件。検査が空振りしている').toBeGreaterThan(0);
    // 置き場所ごとに、ポストへのリンクは1本。スクリプトは最初のリンクを oEmbed に渡すので、2本あるとどれが出るか読み取りにくい。
    expect(
      found.boxes.filter((ids) => ids.length !== 1 || ids[0] === ''),
      'ポストへのリンクが1本ではない置き場所',
    ).toEqual([]);
    // 埋め込みのあるページでは、置き場所の外の属性と data-tweet-id も含めて、ポストの ID を許したものだけにする。
    // widgets.js がどの属性からポストを決めるかに、この検査を合わせないため。
    const ids = [...found.attrIds, ...found.tweetIds];
    expect(ids.filter((id) => !X_EMBEDS[route]!.posts.includes(id)), '許していないポスト').toEqual([]);
  });
}

/**
 * playwright.config.ts の BLOCK_EXTERNAL_EMBEDS が効いていることを見る。
 *
 * 止めるホストは設定に文字で書いてあり、ページの widgets.js の URL（src/pages/references.astro）とはつながっていない。
 * ページの読み込み先を変えると、許可リストと性能予算（tests/artifact/）は落ちて気付けるが、止める側は誰も見ておらず、
 * 規約テストが X を読む状態に黙って戻り、結果が X の描き方と通信に左右される。そこで、規約テストのブラウザで
 * /references/ を開いたとき、X のホストから何も読めていないことと、埋め込みが出なかったときのリンクが残っていることを見る。
 *
 * 通信が止むまで（networkidle）待つ。load までだと、widgets.js を load の後に読む形（見えたら・押したら読む）に
 * 変えたとき、読みに行く前に終わってしまう。数えるのは読み終えたもの（requestfinished）で、止めたホストへの
 * 読み込みは失敗するので数えない。
 */
test('規約テストでは X の埋め込みを読まない — /references/', async ({ page }) => {
  const fromX: string[] = [];
  page.on('requestfinished', (request) => {
    if (X_HOST.test(new URL(request.url()).hostname)) fromX.push(request.url());
  });

  await page.goto('/references/', { waitUntil: 'networkidle' });

  expect(fromX, 'X のホストから読めたもの').toEqual([]);
  await expect(page.locator('[data-x-post] a[href]')).toHaveCount(1);
  await expect(page.locator('[data-x-post] blockquote')).toHaveCount(0);
});

/**
 * src/pages/references.astro の、oEmbed を取って差し込むスクリプト。
 *
 * X には通信せず、page.route で oEmbed の応答を作る。BLOCK_EXTERNAL_EMBEDS は名前を引けなくするだけで、page.route はその前に
 * 横取りする。別オリジンへの fetch なので、作る応答にも CORS のヘッダーを付ける（本物の publish.x.com も付けて返す）。
 * widgets.js は止めたままなので、差し込んだ引用がそのまま残る。
 *
 * 作る応答は、本物の oEmbed の html と同じ形（本文の改行・ハッシュタグと画像のリンク・投稿者・日付のリンク）にする。
 * 差し込んだ引用は、widgets.js が描くまでのあいだ（と widgets.js だけが止められたとき）に出て、このページのスタイルが
 * 当たるので、その状態でも WCAG A/AA を見る（contrast.spec.ts は X を止めたリンクだけの状態しか見ない）。
 */
const OEMBED = /^https:\/\/publish\.x\.com\/oembed\?/;
const CORS = { 'access-control-allow-origin': '*' };

test('oEmbed が返したら、ページのリンクのポストの埋め込みのコードを差し込む — /references/', async ({ page }) => {
  const requested: URL[] = [];
  // ページのリンクは差し込むと消えるので、応答を返す前（横取りした時点）に読む。スクリプトと同じく、解決した URL（a.href）で。
  let href: string | null = null;
  await page.route(OEMBED, async (route) => {
    requested.push(new URL(route.request().url()));
    href = await page.locator('[data-x-post] a[href]').evaluate((a: HTMLAnchorElement) => a.href);
    return route.fulfill({
      headers: CORS,
      json: {
        html:
          '<blockquote class="twitter-tweet" data-lang="ja" data-dnt="true"><p lang="ja" dir="ltr">本文の1行目<br>本文の2行目' +
          '<a href="https://x.com/hashtag/tag?src=hash">#タグ</a> <a href="https://t.co/x">pic.twitter.com/x</a></p>' +
          '&mdash; 投稿者 (@user) <a href="https://x.com/u/status/1">2022年1月22日</a></blockquote>',
      },
    });
  });
  await page.goto('/references/');

  await expect(page.locator('[data-x-post] blockquote.twitter-tweet')).toHaveCount(1);
  await expect(page.locator('[data-x-post] > p')).toHaveCount(0);
  // 頼む中身: ページのリンクのポストを、widgets.js の script を外し、個人向けの調整に使わせない形で。
  expect(
    requested.map((url) => Object.fromEntries(['url', 'omit_script', 'dnt', 'lang'].map((key) => [key, url.searchParams.get(key)]))),
  ).toEqual([{ url: href, omit_script: 'true', dnt: 'true', lang: 'ja' }]);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude(THIRD_PARTY_EMBED).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' / ')}`)).toEqual([]);
});

test('oEmbed が取れなかったら、ポストへのリンクのまま残す — /references/', async ({ page }) => {
  await page.route(OEMBED, (route) => route.fulfill({ status: 404, headers: CORS, body: '' }));
  await page.goto('/references/', { waitUntil: 'networkidle' });

  await expect(page.locator('[data-x-post] a[href]')).toHaveCount(1);
  await expect(page.locator('[data-x-post] blockquote')).toHaveCount(0);
});

test('oEmbed が blockquote でない html を返したら、差し込まない — /references/', async ({ page }) => {
  await page.route(OEMBED, (route) => route.fulfill({ headers: CORS, json: { html: '<img src="x" alt="">' } }));
  await page.goto('/references/', { waitUntil: 'networkidle' });

  await expect(page.locator('[data-x-post] a[href]')).toHaveCount(1);
  await expect(page.locator('[data-x-post] img')).toHaveCount(0);
});
