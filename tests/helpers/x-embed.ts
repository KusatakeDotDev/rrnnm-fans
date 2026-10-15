/**
 * X の埋め込みを使ってよいページと、そのページで埋め込んでよいポスト（docs/adr/0014-x-embed-reference-materials.md と
 * docs/adr/0022-x-embed-skeb-delivery-posts.md の決定）。
 * tests/artifact/build-output.spec.ts（widgets.js を読むページ・JS の中身）と、tests/conformance/x-embed.spec.ts
 * （DOM の埋め込みの要素・ポストの ID・X のホストから直に読むもの）が読む。片方だけ直して食い違わないよう、値はここにだけ書く。
 *
 * **ポストは ID で、ページごとに許す。** X はポストを URL の `/status/<ID>` の ID だけで決め、前のハンドルの部分は見ない
 * （`x.com/nori_tama00/status/<別の人のポストの ID>` でも別の人のポストが出る）。
 *   - /references/: ぴよ汰。様のポスト。docs/FACTS.md §2 で確かめたもの。足すときは、FACTS で確かめてからここに足す
 *   - /skeb/: ご本人の納品のポスト。投稿者が @rurino_nemo で、ポストが指す Skeb の作品が src/content/skeb.ts の作品と同じことを
 *     確かめたもの（docs/OPERATIONS.md「Skeb の作品リンク」）。足すときは、同じことを確かめてから skeb.ts とここに足す
 *
 * `load` は widgets.js を読む時: `open` はページを開いた時点（HTML の `<script src>`）、`click` はポストのリンクを押した時
 * （ページの is:inline のスクリプトが足す）。
 *
 * **これらの検査が防ぐのは、うっかりの取り違え。** 別の人のポストへのリンクを置く、X の埋め込みのコードやタイムラインのコードを
 * 貼る（埋め込みのコードはブラウザで oEmbed から取るもので、ページには書かない）、別のページに置く、など。
 * わざと検査を抜ける書き方（属性の値や文字参照に隠す、入れ子の template に入れる、など）までは追わない。
 * Astro がそういう形を出すことは無く、追うと HTML を読み直す特別扱いが増え続ける。
 */
export const X_EMBEDS: Readonly<Record<string, { load: 'open' | 'click'; posts: readonly string[] }>> = {
  '/references/': { load: 'open', posts: ['1484737271933071361'] },
  '/skeb/': {
    load: 'click',
    posts: [
      '1420022175256489992',
      '1638130119385686016',
      '1638910012822257664',
      '1638910720111968257',
      '1639293743227604992',
      '1639296086262308864',
      '1760689029820174460',
      '1760689870878765366',
      '1760690096574239180',
      '1772639381423022579',
      '1772640132392202415',
      '1772640668499820765',
    ],
  },
};

export const X_EMBED_PAGES = Object.keys(X_EMBEDS);

/** X のホスト（ホスト名に当てる）。X のホストから直に読むものと、規約テストで X を読めていないことの確かめが使う。 */
export const X_HOST = /(?:^|\.)(?:x|twitter|twimg)\.com$/i;
