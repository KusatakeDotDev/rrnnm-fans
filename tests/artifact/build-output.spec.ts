import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { SNAPSHOT_IMAGE_ITEM } from "../../src/components/field-snapshot";
import { BOOTH_GOODS, boothItemUrl } from "../../src/data/goods";
import { SCHEDULE_VIDEO_ID } from "../../src/data/schedule";
import {
  builtPages,
  DIST,
  distTextFiles,
  fixtureBuild,
  isJsonScript,
  PAGE_ORIGIN,
  scriptSrcs,
  toRoute,
} from "../helpers/dist";
import { stringLiterals } from "../helpers/string-literals";
import { X_EMBED_PAGES, X_EMBEDS } from "../helpers/x-embed";

/**
 * ビルド成果物そのものに対する検査。ブラウザを開かない
 * （playwright.config.ts の artifact プロジェクトから回る）。
 *
 * DOM を見る規約テストでは捕まえられないものだけをここに置く。
 * 「レンダリングされないところに混入したもの」が対象。
 */
const builtFiles = distTextFiles();

test("dist に中身がある", () => {
  expect(builtFiles.length).toBeGreaterThan(0);
});

/**
 * docs/OPERATIONS.md §2「APIキーは GitHub Secrets。ビルド時のみ使用し、クライアントには絶対に出さない。
 *   ビルド成果物を grep してキーが含まれていないことをCIで確認する」(Issue rurino-nemo-fansite#12)
 * docs/CONCEPT.md §7「APIキーがビルド成果物に漏れていない」
 */
test.describe("APIキーが漏れていない", () => {
  const leakPatterns = [
    { name: "Google API キー", pattern: /AIza[0-9A-Za-z_-]{35}/ },
    { name: "YOUTUBE_API_KEY という変数名ごとの埋め込み", pattern: /YOUTUBE_API_KEY/ },
    // Astro が import.meta.env を丸ごと吐いてしまう事故を見る。
    { name: "PUBLIC_ でない env の埋め込み", pattern: /\bCLOUDFLARE_API_TOKEN\b/ },
  ];

  for (const { name, pattern } of leakPatterns) {
    test(name, () => {
      const found = builtFiles.filter((f) => pattern.test(f.text)).map((f) => f.rel);
      expect(found).toEqual([]);
    });
  }

  // ビルド時に実キーを渡している場合、その値そのものが出ていないことも見る。
  // ローカルで未設定なら何もしない（CI では Secrets から渡る想定）。
  test("実際に渡された APIキーの値が出ていない", () => {
    const realKey = process.env["YOUTUBE_API_KEY"];
    test.skip(!realKey, "YOUTUBE_API_KEY が未設定");
    const found = builtFiles.filter((f) => f.text.includes(realKey!)).map((f) => f.rel);
    expect(found).toEqual([]);
  });
});

/**
 * docs/CONCEPT.md §3「スケジュールサムネイルをどう扱うか」/ docs/adr/0004-schedule-thumbnail.md
 *
 * サムネイル画像の直リンクは原則禁止だが、**「今週の配信スケジュール」動画1本だけ**は
 * ADR-0004 の判断で例外にしてある（maxresdefault.jpg、未生成なら oEmbed の
 * thumbnail_url = hqdefault.jpg、SNSのリンクカードに似た体裁にする、が条件）。
 *
 * もう1つの例外、再生リストのカルーセルの表紙（docs/adr/0008-playlist-carousel.md）は
 * **ブラウザで取るのでビルド成果物には出ず、ここには映らない。** その縛りは
 * PlaylistGrid.astro のスクリプトと tests/unit/youtube.test.ts が持つ。
 * 再生リストの表紙が dist に紛れ込んだら、ここで落ちるのが正しい。
 *
 * `ytimg.com` を広く拾ってから許可分を引く（`/vi/` に限定しない）。
 * `hqdefault.jpg` 以外の派生パス（`/vi_webp/` 等）が紛れ込んでも見逃さないため。
 * SCHEDULE_VIDEO_ID を書き換えたときは、意図した差し替えかどうかがここにも表れる。
 */
test.describe("配信スケジュールのサムネイル（i.ytimg.com）", () => {
  const allowedThumbnail = `i.ytimg.com/vi/${SCHEDULE_VIDEO_ID}/`;

  const occurrences = builtFiles.flatMap((f) => {
    const matches = [...f.text.matchAll(/[a-zA-Z0-9.-]*ytimg\.com\/[^"'\s)]+/g)].map((m) => m[0]);
    return matches.map((url) => ({ rel: f.rel, url }));
  });

  test("配信スケジュール動画1本以外の直リンクが無い", () => {
    const disallowed = occurrences
      .filter((o) => !o.url.includes(allowedThumbnail))
      .map((o) => `${o.rel}: ${o.url}`);
    expect(disallowed).toEqual([]);
  });

  /**
   * oEmbed 取得の失敗はビルドを落とさず、フォールバック表示（テキストリンク）に
   * 静かに切り替わる設計にしてある（ScheduleCard.astro）。ビルドが成功したまま
   * トップページの主要な絵が消えるのを、ここで検知する。
   */
  test("oEmbed 取得が成功し、サムネイルが実際に出ている", () => {
    const found = occurrences.filter((o) => o.url.includes(allowedThumbnail));
    expect(found.length).toBeGreaterThan(0);
  });
});

/**
 * docs/CONCEPT.md §3「使う」/ docs/adr/0020-booth-goods-images.md
 *
 * BOOTH の画像を出してよいのは、グッズのページの、src/data/goods.ts に書いた商品のリンクカードの中だけ。
 * 画像の URL はビルドのときに取る（src/data/goods-images.ts）ので、dist に出る。取った URL の条件は
 * src/lib/booth.ts と tests/unit/booth.test.ts が見る。ここは、出た先の場所を見る。
 *
 * `pximg.net` を広く拾ってから許可分を引く（`booth.` に限定しない）。pixiv の画像（`i.pximg.net`）が
 * 紛れ込んでも見逃さないため。
 */
test.describe("BOOTH の商品の画像（booth.pximg.net）", () => {
  const GOODS_PAGE = "goods/index.html";

  const occurrences = builtFiles.flatMap((f) => {
    const matches = [...f.text.matchAll(/[a-zA-Z0-9.-]*pximg\.net\/[^"'\s)]+/g)].map((m) => m[0]);
    return matches.map((url) => ({ rel: f.rel, url }));
  });

  /** 未公開のあいだ（ADR-0018）、オフのビルドにはグッズのページが無い。 */
  const hasGoods = builtFiles.some((f) => f.rel === GOODS_PAGE);

  /** グッズのページの HTML。上の occurrences と同じ文字列を見る（読み直さない）。 */
  const goodsHtml = (): string => {
    const file = builtFiles.find((f) => f.rel === GOODS_PAGE);
    if (!file) throw new Error(`dist に ${GOODS_PAGE} が無い`);
    return file.text;
  };

  test("グッズのページの、一覧に書いた商品の画像だけ", () => {
    const disallowed = occurrences
      .filter(
        (o) =>
          o.rel !== GOODS_PAGE ||
          !o.url.startsWith("booth.pximg.net/") ||
          !BOOTH_GOODS.some((item) => o.url.includes(`/i/${item.id}/`)),
      )
      .map((o) => `${o.rel}: ${o.url}`);
    expect(disallowed).toEqual([]);
  });

  /**
   * 画像のすぐ外側の `<a>` を、`<img>` から前へたどって探す。間に `</a>` があれば、リンクの外にある。
   * リンクの行き先は、画像のパスの ID と同じ商品の商品ページでなければならない。
   *
   * **`<img src>` の形で拾えなかった出方を、黙って通さない。** グッズのページに出た `pximg.net` の数と、
   * ここで見た `<img src>` の数を突き合わせる。`srcset`・CSS の背景・引用符の違う `src` などで出ると数が合わず、落ちる。
   */
  test("画像は、その商品の商品ページへのリンクの中にだけある", () => {
    test.skip(!hasGoods, "グッズのページを出さないビルド");
    const html = goodsHtml();
    const images = [...html.matchAll(/<img\b[^>]*\ssrc="([^"]*pximg\.net[^"]*)"[^>]*>/g)];
    expect(
      images.length,
      "<img src> で出ている画像の数が、ページに出た pximg.net の数と合わない",
    ).toBe(occurrences.filter((o) => o.rel === GOODS_PAGE).length);

    const misplaced = images.flatMap((m) => {
      const before = html.slice(0, m.index);
      const open = Math.max(...[...before.matchAll(/<a[\s>]/g)].map((a) => a.index), -1);
      const anchor =
        open === -1 || before.slice(open).includes("</a>")
          ? null
          : /^<a\b[^>]*>/.exec(before.slice(open));
      const href = anchor ? /\shref="([^"]*)"/.exec(anchor[0])?.[1] : undefined;
      const item = BOOTH_GOODS.find((g) => href === boothItemUrl(g.id));
      return item && m[1].includes(`/i/${item.id}/`)
        ? []
        : [`${m[1]}（リンク: ${href ?? "なし"}）`];
    });
    expect(misplaced).toEqual([]);
  });

  /**
   * 画像の下には、いつも花を敷く（src/unreleased/goods.astro）。画像が取れなかったときだけ花を出す形に戻すと、
   * ブラウザで画像が読めなかったとき（お店が差し替えた・コンテンツブロッカーが止めたなど）に、下地の色だけの四角になる。
   */
  test("どのカードの画像の場所にも、花が敷いてある", () => {
    test.skip(!hasGoods, "グッズのページを出さないビルド");
    // 画像の場所（class が image の span）から、次の </span> までを見る。花は Flower.tsx の svg（viewBox="0 0 40 40"）。
    const frames = [
      ...goodsHtml().matchAll(/<span\b[^>]*\sclass="image(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/span>/g),
    ].map((m) => m[1]);
    expect(frames.length, "画像の場所の数が、一覧に書いた商品の数と合わない").toBe(
      BOOTH_GOODS.length,
    );
    expect(frames.filter((inner) => !/<svg\b[^>]*\sviewBox="0 0 40 40"/.test(inner))).toEqual([]);
  });

  /**
   * OGP の取得の失敗はビルドを落とさず、画像の無いカードに落ちる（goods-images.ts。取れなかった理由はビルドのログに出す）。
   * 固定応答のビルドでは BOOTH の応答も決まっているので、画像が1枚も出なければ、取ってから描くまでのどこかが壊れている。
   * 実データのビルド（Release）では、BOOTH の調子で配布を止めないよう、ここでは見ず、scripts/verify-release.mjs が注意を出す
   * （docs/adr/0020-booth-goods-images.md「払うもの」）。一部の商品だけ出なくなったときは、どちらでも落とさない（docs/OPERATIONS.md §6）。
   */
  test("OGP の取得が成功し、画像が実際に出ている", () => {
    test.skip(!hasGoods, "グッズのページを出さないビルド");
    test.skip(
      !fixtureBuild(),
      "実データのビルドでは見ない。scripts/verify-release.mjs が注意を出す",
    );
    expect(
      occurrences.length,
      "固定応答のビルドで、BOOTH の商品ページから画像を1枚も取れていない。取れなかった理由は、ビルドのログの [goods] の行にある",
    ).toBeGreaterThan(0);
  });
});

/**
 * **外部スクリプトは許す側を数える。**
 *
 * 下の「禁止ホスト」は既知のトラッカーを弾くだけで、知らないものは通してしまう。
 * このサイトがページに書いてよい外部スクリプトは、X の埋め込み（platform.x.com の widgets.js。使うページは tests/helpers/x-embed.ts。
 * docs/adr/0014-x-embed-reference-materials.md）の1本だけ。/skeb/ が押したときに足す widgets.js は `<script src>` に
 * 出ないので、下の X の埋め込みの検査が、URL を書いてよいところを絞る
 * （docs/CONCEPT.md §3）と決めたので、**リストに無いホストが1つでも増えたらここが落ちる**形にしておく。
 * X の埋め込みを、どのページで・どのポストに使ってよいかは、下の別のテストと tests/conformance/routes.spec.ts が見る。
 *
 * 増やすときは「これも入れる」とこのリストを直すことになる。
 * そこがレビューで目に入る場所であること自体が狙い。
 *
 * HTML の src は、性能予算と同じ読み方（tests/helpers/dist.ts の scriptSrcs）で読み、URL として解決してホストを見る。
 * 値を拾えない src は scriptSrcs が throw するので、黙って通らない。HTML ではないファイル（JS など）は、文字列に
 * たまたま `<script` と `src` が並ぶことがあり、throw させると誤って落ちるので、引用符の付いた src だけを拾う。
 *
 * **見えるのは dist に `<script src="…">` の形で書いたものだけ。**
 * アクセス解析の beacon（static.cloudflareinsights.com）は Cloudflare が配信の途中で
 * 差し込むので、ここには出てこない。CONCEPT §3 で例外として許し、
 * ダッシュボードの設定は人が見る（Issue rurino-nemo-fansite#132）。
 */
test("外部スクリプトは許可したホストだけ", () => {
  const allowed = ["platform.x.com"];

  const loadedHosts = builtFiles.flatMap((f) =>
    (f.rel.endsWith(".html")
      ? scriptSrcs(f.text, f.rel)
      : [...f.text.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)].map((m) => m[1]!)
    )
      .map((src) => new URL(src, PAGE_ORIGIN))
      .filter((url) => /^https?:$/.test(url.protocol) && url.origin !== PAGE_ORIGIN)
      .map((url) => url.host),
  );

  const disallowed = [...new Set(loadedHosts)].filter((host) => !allowed.includes(host));
  expect(disallowed).toEqual([]);
});

/**
 * docs/adr/0014-x-embed-reference-materials.md の決定
 *
 * X の埋め込みは、推し活の資料のページ（/references/）で、ぴよ汰。様が自分で公開したポストに、Skeb のページ（/skeb/）で、
 * ご本人の納品のポストに（docs/adr/0022-x-embed-skeb-delivery-posts.md の決定）、クソバカスロット（/kusobaka-slot/）で、
 * 元ネタのご本人のポストに（docs/adr/0028-x-embed-kusobaka-slot.md の決定）だけ使う。
 * ページが持つのはポストへのリンク（`data-x-post` の中）だけで、埋め込みのコードは、ブラウザで X の oEmbed（publish.x.com）から
 * 取って差し込む（/references/ と /kusobaka-slot/ は src/components/XPost.astro、/skeb/ は src/unreleased/skeb.astro）。どの要素がどのポストを指すか（data-x-post・class・属性）と、X のホストから直に
 * 読むものは、ブラウザが文字参照と属性の書き方を解いた DOM で見るほうが確かなので、tests/conformance/routes.spec.ts が見る。
 * ここで見るのは、ビルド成果物でしか見えないもの。
 *   - widgets.js を読むページ。許すページは tests/helpers/x-embed.ts（この検査が防ぐ範囲も、そこに書いてある）。開いた時点で読む
 *     ページは HTML の `<script src>` で、押したときに読むページは、そのページの HTML の script の中の URL で見る
 *   - **埋め込みを作る JS は、許したページの、oEmbed を取って差し込むスクリプトだけ。** dist の JS（Astro が書き出したものと、
 *     それが import するもの）と、HTML の script・template の中身に、`twitter-`・`data-tweet-id`・ポストの URL（`/status/<数字>`）
 *     を書かない。ポストは HTML のリンクにだけ書き、その ID を DOM の検査が見る。`twttr` は、差し込んだあとに描かせ直す
 *     `twttr.widgets.load` にだけ使う。X の埋め込みのコードを返すところ（oEmbed の `publish.x.com` など）は、
 *     許したページの HTML の script にだけ書く。
 *     dist の JS は全部読むので、import の先を辿らなくてよい。実行されない JSON の script（構造化データなど）は見ない。
 *     `twttr` は、イベントの属性や `javascript:` の URL にも書けるので、HTML 全体（style とコメントを除く）でも見る
 */
test("X の埋め込みのスクリプトは許したページだけが読み、JS は oEmbed を差し込むほかに埋め込みを作らない", () => {
  // ルートと中身を、builtFiles の同じ1件から取る（読み直さず、引き損ねもしない）。
  const loading = builtFiles
    .filter(
      ({ rel, text }) =>
        rel.endsWith(".html") &&
        scriptSrcs(text, rel).some((src) => new URL(src, PAGE_ORIGIN).host === "platform.x.com"),
    )
    .map(({ path: file }) => toRoute(file));
  // 成果物はファイル名の順、許す一覧は書いた順に並ぶので、並べ替えてから比べる。
  expect(loading.sort(), "widgets.js を開いた時点で読むページ").toEqual(
    X_EMBED_PAGES.filter((route) => X_EMBEDS[route]!.load === "open").sort(),
  );

  // route は、HTML の中の script・template のときだけ。dist の JS ファイルは、どのページから読まれるかを問わない。
  const scripts = builtFiles.flatMap<{ where: string; route: string | null; body: string }>(
    ({ path: file, rel, text }) => {
      if (/\.m?js$/.test(rel)) return [{ where: rel, route: null, body: text }];
      if (!rel.endsWith(".html")) return [];
      const route = toRoute(file);
      return [...text.matchAll(/<(script|template)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)]
        .filter(([, name, attrs]) => !(name!.toLowerCase() === "script" && isJsonScript(attrs!)))
        .map(([, , , body]) => ({ where: rel, route, body: body! }));
    },
  );
  expect(scripts.length, "JS が0件。検査が空振りしている").toBeGreaterThan(0);
  const onEmbedPage = (route: string | null) => route !== null && X_EMBED_PAGES.includes(route);

  // twttr は、許したページの HTML の script で、描かせ直す呼び出し（twttr.widgets.load。`?.` で書いてもよい）にだけ使う。
  // dist の JS ファイル（どのページから読まれるかを問わない）と、ほかのページでは、どんな使い方も落とす。
  const twttrMisuse = (route: string | null) =>
    onEmbedPage(route) ? /\btwttr\b(?!\??\.widgets\??\.load\b)/ : /\btwttr\b/;
  const found = scripts
    .filter(
      ({ route, body }) =>
        /twitter-|data-tweet-id|\/status(?:es)?\/\d/i.test(body) || twttrMisuse(route).test(body),
    )
    .map(({ where }) => where);
  expect(found, "X の埋め込みの語を持つ JS").toEqual([]);

  // X の埋め込みのコードやポストの中身を返すところ。oEmbed（publish.x.com と、旧ホストの publish.twitter.com）と、
  // 埋め込みの iframe が中で使うポストの JSON（syndication）。どれも許したページの HTML の script にだけ書く。
  const X_EMBED_SOURCE = /publish\.(?:x|twitter)\.com|syndication\.(?:x|twitter|twimg)\.com/i;
  const oembed = scripts.filter(({ body }) => X_EMBED_SOURCE.test(body));
  expect(
    oembed.filter(({ route }) => !onEmbedPage(route)).map(({ where }) => where),
    "許していないところで X の埋め込みのコードを取る JS",
  ).toEqual([]);
  expect(oembed.length, "oEmbed を取るスクリプトが0件。検査が空振りしている").toBeGreaterThan(0);

  // 押したときに読むページは、widgets.js をページの script から足すので、`<script src>` の検査に掛からない。URL を書いてよいのは、
  // そのページの HTML の script だけにする。開いた時点で読むページの `<script src>` は中身が空なので、ここには当たらない。
  const clickPage = (route: string | null) => route !== null && X_EMBEDS[route]?.load === "click";
  expect(
    scripts
      .filter(({ route, body }) => /platform\.(?:x|twitter)\.com/i.test(body) && !clickPage(route))
      .map(({ where }) => where),
    "押したときに読むページのほかで、widgets.js の URL を書いた JS",
  ).toEqual([]);
  // 押したときに読むページを作ったビルドでは、そのページに widgets.js を足すスクリプトがある。無ければ上の検査が空振りしている。
  const builtClickPages = X_EMBED_PAGES.filter(
    (route) => clickPage(route) && scripts.some((script) => script.route === route),
  );
  expect(
    builtClickPages.filter(
      (route) =>
        !scripts.some(
          (script) => script.route === route && /platform\.x\.com\/widgets\.js/.test(script.body),
        ),
    ),
    "押したときに widgets.js を読むスクリプトが無いページ",
  ).toEqual([]);

  const callsTwttr = builtFiles
    .filter(({ rel }) => rel.endsWith(".html"))
    .filter(({ path: file, text }) =>
      twttrMisuse(toRoute(file)).test(
        text.replace(/<style\b[\s\S]*?<\/style\s*>/gi, "").replace(/<!--[\s\S]*?-->/g, ""),
      ),
    )
    .map(({ rel }) => rel);
  expect(callsTwttr, "twttr を、許したページの twttr.widgets.load のほかに使うページ").toEqual([]);
});

/**
 * docs/CONCEPT.md §5「広告・アフィリエイトによる収益化」をしない
 * docs/adr/0001-tech-stack.md「アクセス解析 — Cloudflare Web Analytics」（Cookie なし・PII なし）
 */
test("広告・アフィリエイト・第三者トラッカーのスクリプトが無い", () => {
  const blockedHosts = [
    "googletagmanager.com",
    "google-analytics.com",
    "doubleclick.net",
    "adservice.google",
    "amazon-adsystem.com",
    "a8.net",
  ];
  const found = builtFiles.flatMap((f) =>
    blockedHosts.filter((h) => f.text.includes(h)).map((h) => `${f.rel}: ${h}`),
  );
  expect(found).toEqual([]);
});

/**
 * docs/adr/0011-react-components-for-design-sync.md「配らないことはテストで守る」
 *
 * コンポーネントは React（`.tsx`）で書くが、React はビルド時に HTML を書き出すためだけに使う。
 * `client:*` を付けるとクライアントアイランド（`<astro-island>`）になり、React の実行時コードが配られる。
 * **依存を devDependencies に置いても、それは止まらない**（Vite は気にせずバンドルする）ので、ここで見る。
 *
 * レンダラが何かは見ない。ビルド後の `renderer-url` はハッシュ付きのファイル名で、
 * React かどうかを文字列から確実には読めない。今はクライアントアイランドが1つも無いので「無い」を見れば足りる。
 * クライアントアイランドにしてよいコンポーネントが要るようになったら、この検査を外さず、名指しで許す形にし、新しい ADR を立てる。React の JS を配ることになり、ADR-0011 の決定が守っているものを一部手放すため。
 */
test("公開ページにクライアントアイランド（astro-island）が無い", () => {
  const pages = builtPages();
  expect(pages.length, "ページが0枚。検査が空振りしている").toBeGreaterThan(0);

  const withIsland = pages
    .filter(({ file }) => readFileSync(file, "utf8").includes("<astro-island"))
    .map(({ route }) => route);
  expect(withIsland).toEqual([]);
});

/**
 * docs/adr/0011-react-components-for-design-sync.md「スクリプトの扱い」
 *
 * ラッパーのスクリプトは、コンポーネント（`.tsx`）が付けた `data-*` のマーカーで要素を探す。CSS Modules のクラス名は
 * ビルドごとに変わるので、マーカーをクラスにはしない。マーカーの名前はコンポーネントとスクリプトの2か所に文字で書くので、
 * 片方だけ変えても型検査もビルドも通り、並べ替えや名前の差し替えが黙って止まる。
 * そこで、どれかのページで、HTML（スクリプトを除いた部分）とそのページが読むスクリプトの両方に同じ名前が出ていることを見る。
 *
 * スクリプトの側は、**スクリプトの中の文字列リテラル**に `[マーカー]` の形（属性セレクタ）で出ていることを見る。
 * セレクタは `querySelector(All)` に直に書くことも、定数に入れてから渡すことも
 * できるので、呼び出しの形ではなく文字列リテラルを拾う。字句は TypeScript の scanner で読むので、コメントに
 * だけ名前が残っていても通らず、文字列の中の `/*`（`'image/*'` など）をコメントと取り違えることもない。
 *
 * **マーカーは、ページに置いているスクリプト（PlaylistGrid.astro のラッパー、XPost.astro の oEmbed を差し込むもの、
 * src/pages/kusobaka-slot.astro のスロット）が
 * 属性セレクタで探すものを全部並べる。**
 * スクリプトにマーカーを足したら、ここにも足す。スクリプトが自分で付け外しするマーカー（`data-loading`）は、
 * コンポーネントの出力には出ないので入れない。
 */
test("ラッパーのスクリプトが探すマーカーが、コンポーネントの出力とスクリプトの両方にある", () => {
  const HOOKS = [
    "data-playlists",
    "data-playlists-list",
    "data-playlists-item",
    "data-playlists-more",
    "data-playlists-tile",
    "data-playlists-title",
    "data-youtube-thumbnail",
    "data-x-post",
    "data-slot",
    "data-slot-count",
    "data-slot-reel",
    "data-slot-start",
    "data-slot-status",
    "data-slot-stop",
    "data-slot-until",
    "data-slot-mute",
  ];
  const scriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const pages = builtPages().map(({ file }) => {
    const html = readFileSync(file, "utf8");
    const scripts = [...html.matchAll(scriptTag)].map(([, attrs, body]) => {
      const src = /\ssrc="(\/[^"]+)"/.exec(attrs)?.[1];
      return stringLiterals(src ? readFileSync(path.join(DIST, src), "utf8") : body);
    });
    return { markup: html.replace(scriptTag, ""), scripts };
  });

  // スクリプトの側は、文字列リテラルの中に属性セレクタ（`[data-…]`・`[data-…=…]` など）として書いてあることを見る。
  const missing = HOOKS.filter(
    (hook) =>
      !pages.some(
        ({ markup, scripts }) =>
          new RegExp(`<[a-z][^<>]*\\s${hook}(?:=|[\\s>/])`, "i").test(markup) &&
          scripts.some((literals) =>
            literals.some((text) => new RegExp(`\\[${hook}(?:[\\]=~|^$*])`).test(text)),
          ),
      ),
  );
  expect(missing, "HTML とスクリプトの両方に出ているページが無いマーカー").toEqual([]);
});

/**
 * src/components/YouTubeThumbnail.tsx
 *
 * ビルド時に `<img>` を入れた枠には、置く側が、読み込みを待つ（`data-loading` を付け外しする）インラインの
 * スクリプトを置く（今は予定のカードだけ。ScheduleCard.tsx の `LOAD_THUMBNAIL`）。枠はスクリプトを持たないので、
 * 置く側が書き忘れても型検査もビルドも通り、読み込み途中の画像が上から描かれるちらつきが黙って戻る。
 * そこで出力の側で、`<img>` を持つ枠にはそのスクリプトがあることを見る。
 *
 * 枠の中身は、枠の `<span>` を閉じる `</span>` までで区切る（中に `<span>` を足しても区切りがずれないよう、
 * 入れ子を数える）。以前は枠の最後にあった帯の文言で区切っていたが、帯は無くした。
 */
test("ビルド時に画像を入れたサムネイルの枠には、読み込みを待つスクリプトがある", () => {
  const frames = builtPages().flatMap(({ file, route }) => {
    const html = readFileSync(file, "utf8");
    return [...html.matchAll(/<span\b[^>]*\sdata-youtube-thumbnail(?:=|[\s>/])[^>]*>/g)].map(
      (m) => {
        const start = m.index + m[0].length;
        const tag = /<(\/?)span\b[^>]*>/g;
        tag.lastIndex = start;
        let depth = 1;
        let end = -1;
        for (let t = tag.exec(html); t; t = tag.exec(html)) {
          depth += t[1] ? -1 : 1;
          if (depth === 0) {
            end = t.index;
            break;
          }
        }
        // 閉じが見つからない枠を空として飛ばすと、検査する枠が黙って減る（ADR-0003 §5）。
        if (end === -1) throw new Error(`${route}: サムネイルの枠の </span> が見つからない`);
        return { route, inner: html.slice(start, end) };
      },
    );
  });
  expect(frames.length, "サムネイルの枠が0個。検査が空振りしている").toBeGreaterThan(0);

  const withImage = frames.filter(({ inner }) => /<img\b/i.test(inner));
  expect(withImage.length, "ビルド時に画像が入った枠が0個。検査が空振りしている").toBeGreaterThan(
    0,
  );

  const unguarded = withImage
    .filter(({ inner }) => !/<script\b[^>]*>[\s\S]*data-loading[\s\S]*?<\/script>/i.test(inner))
    .map(({ route, inner }) => `${route}: ${inner.slice(0, 80)}`);
  expect(unguarded).toEqual([]);
});

/**
 * docs/adr/0011-react-components-for-design-sync.md
 *
 * Astro は `slot="…"` を React のコンポーネントに props として渡すので、`<Marquee slot="hero" />` と書くと
 * 残りの属性と一緒に root へ `slot` 属性が付く（`.astro` のコンポーネントなら Astro が消す）。
 * シャドウ DOM を使っていないので見た目には効かないが、親から来たものがコンポーネントの root に漏れている。
 * 呼び出し側で `<Fragment slot="hero"><Marquee /></Fragment>` と包めば付かない。
 *
 * `<template>` の中の `slot` はシャドウ DOM 用に書くものなので見ない（今は1つも無い）。
 * `<script>`・`<style>` の中とコメントは HTML の属性ではないので外す。
 *
 * 属性は引用符を考えて読む。値の中に `>` や ` slot=` があっても、タグの切れ目や属性と取り違えない。
 *
 * **読めない形の開始タグは、黙って飛ばさずに落とす。** `TAG` は属性の間に空白を求めるので、
 * `<div a="x"slot="hero">` のような形は1件も当たらない（ブラウザは2つの属性として読む）。
 * `<` の直後が英字の所をすべて開始タグとして数え、`TAG` で読めた位置と突き合わせる
 * （tests/helpers/dist.ts と同じく「検査するトークンが静かに減る」を避ける。ADR-0003 §5）。
 * ただし `TAG` で読めたタグの中（属性値）にある `<` は数えない。Astro は属性値の `<` を
 * エスケープしないので、`title="<b>"` のような正しいタグの値を開始タグと取り違えないため。
 *
 * dist.ts の `TAG`・`ATTR` とは共通にしない。あちらはタグの名前ごとに `[^>]*` で属性を拾う
 * （性能予算が `<link>`・`<script>` だけを見るため）ので、値の中の `>` を越えられない。
 * こちらに寄せると予算の側の読み方が変わり、ほかの検査の意味まで動く。
 */
const TAG =
  /<([a-zA-Z][^\s/>]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTR = /\s+([^\s"'>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

/** HTML の属性として読む部分だけを残す（`<template>`・`<script>`・`<style>` の中とコメントを外す）。 */
const markupOf = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/<(template|script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

test("ページに slot 属性が無い", () => {
  const pages = builtPages();
  const unreadable: string[] = [];
  const withSlot = pages.flatMap(({ file, route }) => {
    const html = markupOf(file);
    const tags = [...html.matchAll(TAG)];
    // 読めたタグの [開始, 終わり) の範囲。範囲の中の `<` は属性値の文字で、タグの始まりではない。
    const spans = tags.map(({ index, 0: tag }) => [index, index + tag.length] as const);
    const read = new Set(spans.map(([start]) => start));
    const insideTag = (at: number) => spans.some(([start, end]) => at > start && at < end);
    for (const { index } of html.matchAll(/<[a-zA-Z]/g)) {
      if (!read.has(index) && !insideTag(index))
        unreadable.push(`${route}: ${html.slice(index, index + 80)}`);
    }
    return tags
      .filter(([, , attrs]) =>
        [...attrs.matchAll(ATTR)].some(([, name]) => name.toLowerCase() === "slot"),
      )
      .map(([tag]) => `${route}: ${tag.slice(0, 80)}`);
  });
  expect(unreadable, "読めない形の開始タグがある。検査が静かに減る").toEqual([]);
  expect(withSlot).toEqual([]);
});

/**
 * docs/adr/0011-react-components-for-design-sync.md
 *
 * `<astro-static-slot>` は、`.astro` から React のコンポーネントに渡した子（や名前付きスロット）を
 * `@astrojs/react` が包む要素。`astro-static-slot { display: contents }` は Astro が
 * クライアントアイランドのあるページにしか入れないので、アイランドの無いこのサイトでは
 * ただの要素として残る。入ると `.copy > h1` のような子結合子のスタイルや、フレックス・グリッドの
 * 項目としての配置が、中身ではなくこのラッパーに当たるようになり、見た目が黙って崩れる。
 *
 * 今のビルドでは1つも出ていない（子は包まれずにコンポーネントの中へそのまま入っている）。
 * `@astrojs/react` のバージョンアップやコンポーネントへの渡し方の変更で出てくるようになったら、ここで落とす。
 * `<template>`・`<script>`・`<style>` の中は見ない。
 */
test("ページに astro-static-slot が無い", () => {
  const wrapped = builtPages()
    .filter(({ file }) => /<astro-static-slot\b/i.test(markupOf(file)))
    .map(({ route }) => route);
  expect(wrapped).toEqual([]);
});

/**
 * docs/adr/0009-nemophila-field-hero.md・docs/adr/0011-react-components-for-design-sync.md「スクリプトの扱い」
 *
 * 畑のラッパー（NemophilaField.astro）の出力の形を見る。
 * - 前回の畑の絵を敷くスクリプトは、`[data-field]` の section の**最初の子**に出る。スクリプトは
 *   `document.currentScript.parentElement` で root を取るので、別の場所に出ると root ではない要素の
 *   `data-state` を読み、そこへ絵を差し込んでしまう
 * - 見出しは `.copy` の**直接の子**に出る。見出しの大きさ・2行割りは `.copy > h1` の子結合子で
 *   当てているので、`@astrojs/react` がスロットの中身を `<astro-static-slot>` などで包むと、どれも当たらなくなる
 *
 * `.copy` のクラス名は CSS Modules でビルドごとに変わるので、`_copy_` で始まる名前で探す。
 */
test("畑のラッパーの出力: 敷くスクリプトが root の最初の子、見出しが .copy の直接の子", () => {
  const fields = builtPages().flatMap(({ file, route }) => {
    const html = readFileSync(file, "utf8");
    return [...html.matchAll(/<section\b[^>]*\sdata-field=""[^>]*>/g)].map((m) => ({
      route,
      after: html.slice((m.index ?? 0) + m[0].length),
    }));
  });
  expect(fields.length, "畑が1つも無い。検査が空振りしている").toBeGreaterThan(0);

  // 保存先の名前はスクリプトと同じところから読む（名前を変えても、検査だけが落ちることは無い）。
  const snapshotRead = `sessionStorage.getItem('${SNAPSHOT_IMAGE_ITEM}')`;
  const snapshotNotFirst = fields
    .filter(({ after }) => !/^<script>([^<]*)/.exec(after)?.[1]?.includes(snapshotRead))
    .map(({ route, after }) => `${route}: ${after.slice(0, 80)}`);
  expect(snapshotNotFirst, "敷くスクリプトが section の最初の子に無い").toEqual([]);

  const headingNotDirect = fields
    .map(({ route, after }) => {
      const copy = /<div class="_copy_[^"]*"[^>]*>/.exec(after);
      const start = copy ? (copy.index ?? 0) + copy[0].length : -1;
      return { route, next: copy ? after.slice(start, start + 80) : "(.copy が無い)" };
    })
    .filter(({ next }) => !/^<h[12][\s>]/.test(next))
    .map(({ route, next }) => `${route}: ${next}`);
  expect(headingNotDirect, "見出しが .copy の直接の子に無い").toEqual([]);
});
