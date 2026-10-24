/**
 * 「今週の配信スケジュール」動画のリンクカード。docs/adr/0004-schedule-thumbnail.md。
 *
 * 本家配信ページへの導線であって、サイト独自のコンテンツではないと一目で分かる体裁にする（誤認防止。docs/CONCEPT.md §2、
 * ADR-0004「サムネイル表示の可否についての判断」）。
 *
 * **データは受け取るだけで、取りに行かない。** 取得はビルド時の fetch で、React のコンポーネントの中では
 * 待てない（`@astrojs/react` のレンダラは async のコンポーネントを描けない）。取るのはラッパーの
 * ScheduleCard.astro（ページはそちらを読む）。Claude Design の見本では、ここに
 * 作り物の `schedule` を渡せば描ける。
 *
 * **画像の URL は、ページを開いたときにスクリプトが決める**（下の `LOAD_THUMBNAIL`。理由は
 * ADR-0004「サムネイルの URL にクエリを付ける」）。
 *
 * **ほかの属性は受け取らない。** 取れたかどうかで root の要素が替わる（カードの div か、
 * テキストリンクの a か）ため（docs/adr/0011「props の決まり」の例外）。
 */
import { cx } from "../lib/cx";
import { OFFICIAL } from "../data/official";
import styles from "./ScheduleCard.module.css";
import { T_WINDOW_MS, WATCH_URL as watchUrl } from "../data/schedule";
import YouTubeThumbnail from "./YouTubeThumbnail.tsx";

/**
 * `schedule` の型は、ここに中身の見える形で書く（名前の付いた型にしない）。
 * 同期（Claude Design）の変換は名前の付いた型を展開せず、名前だけを渡してしまうため。
 * 取る側（schedule-oembed.ts）はこの型から `ScheduleData` を作るので、型は1か所にしか無い。
 * 取るのはビルド時で、schedule-oembed.ts は fetch を持つ。このコンポーネントからは読まない
 * （読むと同期のバンドルにまで取得のコードが入る）。
 */
export interface ScheduleCardProps {
  /** ビルド時に取った oEmbed とサムネイル。取れなかったときは `null`（リンクだけの表示に落ちる）。 */
  schedule: {
    /** 配信の oEmbed のうち、カードが使う分。 */
    oembed: {
      title: string;
      /** 出典の行に出す作者名。取れなかったときは無し（「出典：＜タイトル＞」で描く）。 */
      author_name?: string;
      provider_name: string;
    };
    /** 敷く画像。maxresdefault が無ければ oEmbed の hqdefault。 */
    thumbnail: { url: string; width: number; height: number };
  } | null;
}

/**
 * URL のクエリ `t` の値を作る式（区切りの長さと、時計のずれを受け入れたことは ADR-0004「サムネイルの URL にクエリを付ける」）。
 * `<head>` の preload と、下のスクリプトの両方に同じものを埋め込む。片方だけ変えると番号がずれ、同じ画像を2回取る。
 */
const T_VALUE = `Math.floor(Date.now() / ${T_WINDOW_MS})`;

/** `<head>` の preload の `<link>` に付けるマーカー。下のスクリプトはこれで preload を探し、その URL をそのまま使う。 */
const PRELOAD_MARKER = "data-schedule-thumbnail";

/**
 * `<head>` で、`?t=` 付きの URL を先に取りに行くスクリプト（`<link rel="preload" as="image">` を足す）。
 * トップ（src/pages/index.astro）が、Base.astro の `preload` スロットに置く。
 *
 * **カードの直後のスクリプト（下の `LOAD_THUMBNAIL`）だけだと、取りに行くのが遅い。** あちらは `<head>` の CSS を
 * 読み終えるまで走らない。2560×1305 で回線を 4 Mbps・150 ms に絞ると、画像を取りに行き始めるのは main の約 190 ms から
 * 約 490 ms に、LCP（この大きさでは、このサムネイル）は約 1.5 s から約 2.5 s になった。`<head>` で先に取りに行くと、
 * 約 190 ms・約 1.5 s に戻り、取るのも1回のままだった（2026-10-08 に Chromium で確かめた）。
 *
 * `loading` を知らないブラウザでは何もしない（下のスクリプトもクエリ無しのままにするので、ここで取ると2回になる）。
 */
export function preloadThumbnailScript(plain: string): string {
  // </script> を閉じさせないよう、< をエスケープしてから埋め込む。
  const literal = JSON.stringify(plain).replace(/</g, "\\u003c");
  return `
  (() => {
    if (!('loading' in HTMLImageElement.prototype)) return;
    const url = new URL(${literal});
    url.searchParams.set('t', ${T_VALUE});
    const link = Object.assign(document.createElement('link'), { rel: 'preload', as: 'image', href: url.href });
    link.setAttribute('${PRELOAD_MARKER}', '');
    document.head.append(link);
  })();
`;
}

/*
 * サムネイルの URL に `t` を付けて入れ、読み込みとデコードが済んでからフェードで出すスクリプト
 * （理由は ADR-0004「サムネイルの URL にクエリを付ける」。フェードの見た目は YouTubeThumbnail.module.css の `img[data-loading]`）。
 * 開いたままのタブに戻ってきたとき（visibilitychange）と、bfcache から戻ったとき（pageshow）は、
 * カードが画面の近くにあれば付け直す（離れていれば、あとで近づいたときに付け直す）。
 *   - **`<img>` は `loading="lazy"` で書き、`src` を替えてから eager に戻す。** lazy の `<img>` は
 *     プリロードスキャナーが取りに行かないので、元の URL を落とさずに済む（2026-10-08 に Chromium・Firefox・WebKit で
 *     確かめた。lazy を付けずに書くと、Chromium は同じ画像を2回落とした）。スクリプトが動かないとき（JS が無いときも）は、
 *     lazy のまま元の URL で出る（同じく3つで確かめた）。`loading` を知らないブラウザでは lazy が効かず、元の URL を
 *     先に取ってしまうので、URL は替えない（クエリ無しのまま。フェードだけ付ける）
 *   - **最初の `src` は、`<head>` の preload（上の `preloadThumbnailScript`）の URL を使う。** 自分で計算し直すと、
 *     あいだに5分の区切りをまたいだときに、別の URL をもう1回取る。preload が無いか、`t` を外すとこの画像の URL に
 *     ならないとき（トップ以外に置いた・のちに片方だけ取り方を変えた）は、自分で決める
 *   - **`data-loading` の付け外しは、このスクリプトだけが持つ。** `src` を入れて読み終えていなければ付け
 *     （読み終えている（キャッシュ）なら付けない。同じ5分の中で開き直したときは、キャッシュから出てフェードしない。
 *     Chromium で確かめた）、`load` でデコードを済ませてから外す。
 *     `decode()` は `load` の中で呼ぶ。`src` を替えた直後に呼ぶと、Firefox では替える前の画像で解け、「無い」画像（120×90）が
 *     引き伸ばされて見えた（2026-10-08 に確かめた）。同じ手順（読み込みとデコードが済んでから外す）が
 *     PlaylistGrid.astro のスクリプトにもある。片方を直したら、もう片方も合わせる
 *   - `t` を付けた画像が取れないか、幅が `width` と違えば、クエリ無しの URL に戻す。YouTube は無い画像に
 *     404 と 120×90 の JPEG を返す。Chromium・Firefox・WebKit のどれでも `error` は起きず、`load` で 120×90 として来る
 *     （2026-10-08 に、存在しない動画の URL で確かめた）。`t` がいつか同じ扱いになっても、カードは空にならない。
 *     取れなかったとき（`error`）は `pending` もクエリ無しにして、次の機会（タブに戻る・画面に近づく）に `t` 付きを取り直す。
 *     幅が違ったとき（「無い」画像）は `pending` を戻さず、同じ5分の中では取り直さない（何度取っても「無い」画像が返るだけ）。
 *     `src` を入れた時点でキャッシュから幅の違う画像が出てきたら、描かれる前にクエリ無しへ戻す。クエリ無しへ戻すときは、
 *     キャッシュにあっても透明にする（`load` で外れる）。付け直しの途中で、出ている画像が取れなかったときは、
 *     `pending`（付け直している URL）を戻さない
 *   - IntersectionObserver の最初の呼び出しでは、取りに行かない。最初の `t` 付きがすぐに失敗してクエリ無しに戻した
 *     あとで、同じ URL をすぐ取り直さないため。区切りが変わったかでは決めない（開いた直後に区切りをまたぐと、preload と
 *     同じ画像をもう1回取る）。ただし最初の呼び出しより前に `visibilitychange`・`pageshow` が来ていたら（そのときは近いか
 *     どうかがまだ分からない）、最初の呼び出しで付け直す（`missed`）。バックグラウンドのタブで開いたときに、この順番になると
 *     見ている（手元では、その状況を作って確かめていない）
 *   - try/catch で包まない。どこで止まっても、`<img>` は lazy のままクエリ無しの URL で出る
 *   - **付け直すときは、別の `Image` で読み込みとデコードを済ませてから差し替える。** 出ている `<img>` の
 *     `src` をそのまま替えると、新しい画像が届くまで前の画像も消える（Chromium で確かめた）。取りに行っている途中の
 *     URL は `pending` に持ち、同じ URL を2回取らず、追い越された古い URL に戻さない。取れなかったら戻し、次の機会に取り直す。
 *     「無い」画像（幅が違う）が返ったときは、差し替えず、`pending` も戻さない
 *   - クエリの名前に `v` を使わない。i.ytimg.com は `?v=<大きな数>` に 404 を返す（2026-10-08 実測）
 * 動きは tests/e2e/schedule-thumbnail.spec.ts が見る。
 */
const LOAD_THUMBNAIL = `
  (() => {
    const img = document.currentScript.previousElementSibling;
    const plain = img.src;
    const width = Number(img.getAttribute('width'));
    const current = () => {
      const url = new URL(plain);
      url.searchParams.set('t', ${T_VALUE});
      return url.href;
    };
    const reveal = () => img.removeAttribute('data-loading');
    const toPlain = () => {
      img.setAttribute('data-loading', '');
      img.src = plain;
    };
    const show = (href) => {
      img.src = href;
      if (img.naturalWidth > 0 && img.naturalWidth !== width) return toPlain();
      if (!img.complete) img.setAttribute('data-loading', '');
    };
    let pending = plain;
    img.addEventListener('load', () => {
      if (img.naturalWidth !== width && img.src !== plain) return toPlain();
      img.decode().then(reveal, reveal);
    });
    img.addEventListener('error', () => {
      if (img.src === plain) return reveal();
      if (pending === img.src) pending = plain;
      toPlain();
    });
    if (!('loading' in HTMLImageElement.prototype)) {
      if (!img.complete) img.setAttribute('data-loading', '');
      return;
    }
    const preload = document.querySelector('link[${PRELOAD_MARKER}]')?.href;
    const preloaded = preload && new URL(preload);
    preloaded?.searchParams.delete('t');
    pending = preloaded?.href === plain ? preload : current();
    show(pending);
    img.loading = 'eager';
    let near = false;
    let observed = false;
    let missed = false;
    const reload = () => {
      const href = current();
      if (!near || href === pending) return;
      pending = href;
      const next = new Image();
      next.src = href;
      next.decode().then(
        () => pending === href && next.naturalWidth === width && (img.src = href),
        () => pending === href && (pending = img.src),
      );
    };
    const returned = () => (observed ? reload() : (missed = true));
    new IntersectionObserver((entries) => {
      near = entries[entries.length - 1].isIntersecting;
      const again = observed || missed;
      observed = true;
      if (again) reload();
    }, { rootMargin: '100% 0px' }).observe(img);
    addEventListener('pageshow', (event) => event.persisted && returned());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && returned());
  })();
`;

export default function ScheduleCard({ schedule }: ScheduleCardProps) {
  if (!schedule) {
    return (
      <div className={styles.root}>
        <a
          className={cx(styles.schedule, styles.fallback)}
          href={OFFICIAL.youtube}
          target="_blank"
          rel="noopener noreferrer"
        >
          最新の配信スケジュールを見る ↗
          <span className="sr-only">（外部サイトを新しいタブで開く）</span>
        </a>
      </div>
    );
  }

  const { oembed, thumbnail } = schedule;
  return (
    <div className={styles.root}>
      {/* キャプションはリンクの外（.caption は下の兄弟）。<a> の中に入れると
          テキストの無い横方向の余白までホバー／クリック対象になってしまう
          （<a> は箱全体が当たり判定を持つため）。可視テキストが <a> の中から
          消える分、読み上げ名は aria-label で明示する。 */}
      <a
        className={styles.schedule}
        href={watchUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${oembed.title}（${oembed.provider_name} で見る。外部サイトを新しいタブで開く）`}
      >
        <YouTubeThumbnail>
          {/* タイトルは下のキャプションで見えているので alt="" でよい。
              loading="lazy" は、元の URL をプリロードスキャナーに先に取らせないために付ける。直後のスクリプトが
              ?t= 付きに替えてから eager に戻す（上の LOAD_THUMBNAIL）。見本（Claude Design・Storybook）では
              スクリプトを置かないので lazy のままになるが、見本の側で lazy を写す理由は無い。 */}
          <img
            src={thumbnail.url}
            loading="lazy"
            width={thumbnail.width}
            height={thumbnail.height}
            alt=""
          />
          {/* サーバーで描くとき（Astro のビルド）だけ置く。ブラウザの React（Claude Design・Storybook の見本）で描いた
              <script> は動かず、React 19 の開発版が console.error を出すだけ。サイトはクライアントアイランドを
              持たない（docs/adr/0011）ので、サイトの出力は変わらない。 */}
          {typeof document === "undefined" && (
            <script dangerouslySetInnerHTML={{ __html: LOAD_THUMBNAIL }} />
          )}
        </YouTubeThumbnail>
      </a>
      {/* 出典の行（ADR-0004「出典の行に作者名を出す」）。作者名が取れなかったら省く（カードごとテキストリンクに
          落とすほどのことではない）。行自体はリンクにしない（ホバーで反応させたいのは画像だけ）が、
          タイトルは独立した <a> にして、ここからも元動画へ飛べるようにする。
          「出典：」と作者名は1つの文字列にまとめて渡す。文字と式を並べると React が間に
          `<!-- -->` を挟み、字の並べ方が変わる（ADR-0011「props の決まり」）。
          data-schedule-source は、出典の行があることをテストが探すマーカー。文言は探さない。 */}
      <span className={styles.caption} data-schedule-source="">
        {oembed.author_name ? `出典：${oembed.author_name} ` : "出典："}
        <a
          className={styles.captionTitle}
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {oembed.title}
          <span className="sr-only">（外部サイトを新しいタブで開く）</span>
        </a>
      </span>
    </div>
  );
}
