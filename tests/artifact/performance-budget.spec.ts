import { expect, test } from '@playwright/test';

import { builtPages, distFiles, fieldAssetBytes, routeAssets } from '../helpers/dist';

/**
 * docs/DESIGN.md §6 性能予算 / docs/adr/0006-performance-budget.md
 *
 * 「軽さ」は ADR-0001 の選定理由そのものだが、長いあいだ散文でしか書かれておらず、
 * 検査が1つも無かった。**速度の劣化をバイト数の上限で捕まえる**のがこの層3。
 *
 * 時間（LCP / Lighthouse）で測らないのは、共有ランナー上の数値が揺れて、
 * 閾値を上げるのが習慣になるため。ADR-0003 が VRT を却下したのと同じ理由。
 */

const KiB = 1024;

/** 線の引き方の根拠は ADR-0006「線の引き方」。落とすための線ではなく、気付くための線。 */
const BUDGET = {
  /** webfont の `@font-face` の CSS（全ページ共通）。内容に比例しない。Zen Maru Gothic のウェイトか、同じように分けた日本語の書体を1つ足すと届く位置に置く。 */
  fontFaceCss: 100 * KiB,
  /**
   * 1ページの webfont（`@font-face` の CSS と、ページの字が当たるチャンク）。ページの字に比例する。
   * どの字もすべてのウェイトで描くとみなした上限で測るので、実際に読む量より大きく出る。今の最大のおよそ 1.5 倍に置く。
   */
  routeWebfont: 2816 * KiB,
  /** 内容に比例しない。React を1本入れると届く位置に置く（ADR-0001「フレームワーク — Astro」の「ブラウザに配る JS には依存を足さない」）。 */
  routeJs: 30 * KiB,
  /** 内容に比例する。日常の増分では動かず、破局的な増え方だけを拾う。 */
  routeTransfer: 100 * KiB,
  /**
   * トップの畑が後から取りに行く素材（株のメッシュとテクスチャ）。内容に比例しない。
   * 素材は 95KiB ほど（どちらも生）。テクスチャを 2048px にする・法線マップを足す、で届く位置に置く（ADR-0009）。
   */
  fieldAssets: 150 * KiB,
};

/**
 * 測れないものとして、初期転送量から名指しで外す別ホストの JS（ルートごと）。
 * ADR-0006「別ホストの CSS・JS は測れない」の「名指しで外す」。ルートとURLの両方で絞り、ほかのページで読んだら落ちる。
 * ここに並べるのは dist にあるもの（ページに書いたもの）だけ。アクセス解析の beacon は dist に無いので、
 * もともとこの予算から見えない（下の初期転送量のテストのコメント）。
 *   - X の埋め込み（docs/adr/0014-x-embed-reference-materials.md）。widgets.js の後に X の iframe がさらに読むので、
 *     固定値を足しても実際の量にならない
 */
const UNMEASURED_EXTERNAL: Record<string, string[]> = {
  '/references/': ['https://platform.x.com/widgets.js'],
  '/kusobaka-slot/': ['https://platform.x.com/widgets.js'],
};

const pages = builtPages();

const kib = (bytes: number): string => `${(bytes / KiB).toFixed(1)} KiB`;

/**
 * 予算が**静かに空振りする**のを防ぐ。ビルドの読み方を間違えて対象が0枚になっても、
 * for ループは黙って回らないだけで CI は緑になる（→ ADR-0003 §5 の「検査するトークンが
 * 静かに減るだけ」と同じ事故）。
 */
test('予算を掛けるページが1枚以上ある（予算の空振り防止）', () => {
  expect(pages.length, 'ページが0枚。ビルドが壊れている').toBeGreaterThan(0);
});

for (const { route, file } of pages) {
  // 下のテストで同じ HTML を読み直して gzip し直さないよう、最初に要ったときに1回だけ測る。
  // モジュールの評価時に測らないのは2つの理由から。fullyParallel ではワーカーごとに
  // 全ルート分を測ることになる。解決できない参照の throw が、そのルートのテストの失敗ではなく
  // ファイルの読み込みエラーとして出てしまう。
  let measured: ReturnType<typeof routeAssets> | undefined;
  const assets = (): ReturnType<typeof routeAssets> => (measured ??= routeAssets(file));

  test(`JS が ${kib(BUDGET.routeJs)} 以内 — ${route}`, () => {
    const { jsGzip } = assets();

    // ブラウザに配る JS に依存を足さない決まり（ADR-0001「フレームワーク — Astro」）を、真偽値ではなく量で守る。
    expect(jsGzip, `JS ${kib(jsGzip)}（gzip後）`).toBeLessThanOrEqual(BUDGET.routeJs);
  });

  test(`初期転送量が ${kib(BUDGET.routeTransfer)} 以内 — ${route}`, () => {
    const { htmlGzip, cssGzip, jsGzip, external } = assets();

    // 別ホストの CSS・JS は dist に無く、下の合計に入っていない。**読んでいること自体で落とす。**
    // 黙って通すと、別ホストのスクリプトを公開ページに置いた日から予算が静かに甘くなる。
    // 置くときの決め方は ADR-0006「別ホストの CSS・JS は測れない」。
    // 名指しで外したものは UNMEASURED_EXTERNAL。測れないものとして外し、大きさは ADR-0006 の経緯に書いてある。
    // アクセス解析の beacon（static.cloudflareinsights.com）は、ここにも JS の予算にも入らない。
    // Cloudflare が配信の途中で差し込むので dist に無い（同じ節）。
    const unmeasured = UNMEASURED_EXTERNAL[route] ?? [];
    expect(
      external.filter((ref) => !unmeasured.includes(ref)),
      '別ホストの CSS・JS・webfont を読んでいて、初期転送量を測れない',
    ).toEqual([]);

    // webfont（チャンクと @font-face の CSS）は下の別の線で見る。
    const total = htmlGzip + cssGzip + jsGzip;
    const breakdown = `HTML ${kib(htmlGzip)} + CSS ${kib(cssGzip)} + JS ${kib(jsGzip)}`;

    expect(total, `初期転送量 ${kib(total)} — ${breakdown}`).toBeLessThanOrEqual(BUDGET.routeTransfer);
  });

  test(`webfont の @font-face の CSS が ${kib(BUDGET.fontFaceCss)} 以内 — ${route}`, () => {
    const { webfont } = assets();

    expect(webfont.cssGzip, `@font-face の CSS ${kib(webfont.cssGzip)}（gzip後）`).toBeLessThanOrEqual(BUDGET.fontFaceCss);
  });

  test(`webfont の @font-face が描画を止める CSS に無い — ${route}`, () => {
    const { webfont } = assets();

    // src/styles/fonts.css をふつうに import すると、数百の面が描画を止める CSS に入り、初期転送量の線（webfont を除く）にも出ない。
    expect(webfont.blockingFaces, '描画を止める CSS にある、url() で読む @font-face の数').toBe(0);
  });

  test(`webfont が ${kib(BUDGET.routeWebfont)} 以内 — ${route}`, () => {
    const { webfont } = assets();
    const chunks = webfont.files.reduce((sum, f) => sum + f.bytes, 0);
    const total = webfont.cssGzip + chunks;
    const breakdown = `@font-face の CSS ${kib(webfont.cssGzip)} + チャンク ${webfont.files.length} 本 ${kib(chunks)}`;

    // ADR-0001「「軽さ」の実際のボトルネック」の「フォントがサイト全体の重量の大半を占める」。
    expect(total, `webfont ${kib(total)} — ${breakdown}`).toBeLessThanOrEqual(BUDGET.routeWebfont);
  });
}

/**
 * webfont は woff2 だけを出す。woff は astro.config.mjs の PostCSS が `@font-face` の src から外している。
 * 外れなくなっても、ブラウザは woff を取りに行かないので見た目にも上の線にも出ず、dist と `@font-face` の CSS だけが重くなる。
 */
test('dist に woff を出さない', () => {
  expect(distFiles().filter((f) => f.endsWith('.woff'))).toEqual([]);
});

/**
 * docs/adr/0009-nemophila-field-hero.md「花の3Dモデル」
 *
 * 畑の素材は HTML から参照されず、使うときもスクリプトが描ける環境でだけ取りに行く。初期転送量には
 * 入らないので、別の線で見る。0件は落とさない — 無ければ一枚絵の花で描く設計で、
 * 配布物の有無と単独素材の除外は field-bundle.spec.ts が確かめる。
 */
test(`畑の素材が ${kib(BUDGET.fieldAssets)} 以内`, () => {
  const assets = fieldAssetBytes();
  const total = assets.reduce((sum, a) => sum + a.bytes, 0);
  const breakdown = assets.map((a) => `${a.rel} ${kib(a.bytes)}`).join(' / ') || '(素材無し)';
  expect(total, breakdown).toBeLessThanOrEqual(BUDGET.fieldAssets);
});
