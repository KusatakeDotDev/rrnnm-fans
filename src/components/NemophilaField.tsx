/**
 * トップのヒーロー。画面いっぱいのネモフィラ畑（docs/adr/0009-nemophila-field-hero.md）の見た目。
 *
 * **JS と WebGL2 があれば畑を描き**（src/components/field-renderer.ts）、無ければ CSS のグラデーションの畑のまま止まる。
 * **見出しと配信のピルは HTML** なので、どちらの場合も同じものが読める
 * （docs/adr/0001-tech-stack.md 要件2、ADR-0009「どこまで崩すか」）。
 *
 * **ここは見た目だけ。** 畑を描くスクリプト（`mountField`）はラッパーの NemophilaField.astro が持つ
 * （ADR-0011「スクリプトの扱い」）。これ（default export）を直に置くと、CSS のグラデーションの畑のまま止まり、
 * 見出しもすぐ出る（Claude Design の見本ではそれで足りる）。スクリプトはコンポーネントの中を `data-field*` で探すので、
 * ここの `data-*` 属性の名前はラッパーのスクリプトと対。
 *
 * **状態は `data-state` で持つ**（ふだん `day` ／配信前 `soon` ／配信中 `live`）。
 * 空と畑の色、見出しの色、ピルの文言が組で切り替わる。出どころはまだ無く、今はビルド時に `day` を書くだけ
 * （ADR-0009「状態の出どころ」）。
 * 属性を書き換えれば描画中の畑も色を移していくので、出どころができたらそこから書き換える。
 *
 * **色は状態ごとの組でしか使えない。** 配信中の夜空に本文色（比 1.03）は置けず、
 * 昼の空に白（1.71）は置けない。だから組の選択はページ側に渡さず、ここが `data-state` から
 * 決める（分類バッジの面と文字色と同じ形）。上に置く文字と空・霞・霧の比は
 * tests/unit/palette.test.ts が見る — axe はグラデーションとキャンバスの上の文字を
 * 測れず、violation ではなく incomplete に落として素通りするため。花に掛かるところと、
 * 文字の後ろに敷くにじみの効き目は、描いた畑の上でしか測れないので、
 * `pnpm field:contrast`（scripts/measure-field-contrast.mjs。GPU が要るので手元だけ）で測る。
 *
 * 子には見出しを入れる（畑の上の空に出る）。
 *
 * キャッチと添え書きは面も縁取りも持たない文字で、花に掛かっても沈まないよう、
 * 添え書き（夜はキャッチも）にぼかしたにじみを敷く
 * （ADR-0010「ヒーロー — 畑はそのまま、上に乗るものを組み直す」）。
 */
import type { HTMLAttributes } from 'react';

import type { FieldState } from '../lib/field';
import { cx } from '../lib/cx';
import {
  SMALL_SCREEN_PX,
  SNAPSHOT_GIVE_UP_MS,
  SNAPSHOT_IMAGE_ITEM,
  SNAPSHOT_KEY_ITEM,
  SNAPSHOT_READ_EVENT,
} from './field-snapshot';
import styles from './NemophilaField.module.css';
import { OFFICIAL } from '../data/official';

interface NemophilaFieldProps extends Omit<HTMLAttributes<HTMLElement>, 'dangerouslySetInnerHTML'> {
  /** 見出しの下に添える短い文。 */
  lede: string;
  /** 畑の状態。既定はふだん。 */
  state?: FieldState;
  /** ピル「今週の配信予定」の行き先（ページ内の配信スケジュール）。 */
  scheduleHref?: string;
}

/*
 * **前回の畑の絵を先に敷く。** ラッパーのスクリプトが撮っておいた最初の1枚（src/components/field-snapshot.ts の保存先）が、
 * 今と同じキーで撮ったものなら、キャンバスの下に敷く。本物が描けるまでの待ちを隠すため。
 * 敷いた絵を外すのはラッパーのスクリプト（本物が重なり終わったとき・描けなかったとき）。バンドルしたスクリプトが読めなかったときに
 * 止まった絵が残らないよう、ここでもタブが表に出てから一定の時間（SNAPSHOT_GIVE_UP_MS）が過ぎたら外す。
 *
 * **キーを作るのはここだけ。** ウィンドウの幅（畑の幅が決まる）・畑の高さ・狭い画面か（花や株の数が減る。mountField の
 * isSmall と同じしきい値 SMALL_SCREEN_PX）・解像度・状態・動きを減らす設定・ビルド（描き方が変わったら撮り直す）で、どれかが違えば最初の1枚も違う。
 * 畑の幅（`clientWidth`）は使わない — 読み込みの途中ではまだスクロールバーが無く、読み終えると出て幅が変わる
 * （ウィンドウの幅は変わらず、出たあとの幅はウィンドウの幅で決まる）。ウィンドウの高さ（`innerHeight`）もそのままは使わない — スマートフォンでは
 * アドレスバーの出し入れで変わるが、畑の高さ（svh）と最初の1枚は変わらない。
 * 畑の高さは、絵が置いてあるかによらず読む（撮る側もキーを使う）。読み込みの途中でレイアウトを1回させるが、まだページの頭しか無いので軽く、
 * 最初の描画より後に遅らせると敷くのが間に合わない。
 * 作ったキーは root の `data-field-snapshot-key` に書き、撮る側はそれを読む（作り方を2か所に書かない）。
 * キーを作ったあとで大きさが変わったら、撮る絵がキーと合わなくなるので、ここでキーを消す（撮る側はキーが無ければ撮らない）。
 * 敷いた絵も外す（前の大きさで撮った絵が、新しい大きさに引き伸ばされて見えるため）。
 * 監視するのは撮る側がキーを読むまで。読んだら root に `field-snapshot-read` を送ってもらい、監視を外す。
 * キーが合ったときだけ大きい絵を読む（最初の描画の前に走るので、合わない絵を読んで捨てる手間を掛けない）。
 * 保存先は1つなので、使うのはページで最初の畑だけ。
 *
 * 本物より先に出したいので、ここだけ読み込みを待たないスクリプトにする（バンドルされる <script> は HTML を読み終えてから走る）。
 * JS が無い・WebGL2 が無いときは何もせず、CSS の畑のまま。
 * **ラッパー専用の `NemophilaFieldWithSnapshot`（下）だけが出す。** 外すスクリプトが無いところで敷くと、絵が残り続ける。
 * 出すかどうかを props にしないのは、props が Claude Design に同期する API（NemophilaFieldProps）に出るため。
 *
 * **root の最初の子に置く**（`parentElement` で root を取る）。書き出された HTML のその場で走る。
 * 中に `<` を書かない（検査がスクリプトの終わりを `<` で見分ける）。
 */
/**
 * ビルドごとに変わる値。HTML を書き出すときに1回だけ決まる（読み込み直したタブが、更新前の絵を敷き続けないため）。
 * 描き方の中身のハッシュにしないのは、畑と関係の無いデプロイで外れても、損はそのタブで1回だけ絵を敷かずに待つこと（保存先は sessionStorage）なため。
 */
const BUILD = Date.now().toString(36);

const SNAPSHOT_SCRIPT = `
    (function (root) {
      if (!root || !('WebGL2RenderingContext' in window)) return;
      if (document.querySelector('[data-field-snapshot-key]')) return;
      var size = function () {
        return innerWidth + 'x' + root.clientHeight + (${SMALL_SCREEN_PX} > Math.min(innerWidth, innerHeight) ? ' small' : '');
      };
      var sizeAtKey = size();
      var img = null;
      var key = [
        '${BUILD}',
        sizeAtKey,
        devicePixelRatio,
        root.dataset.state,
        matchMedia('(prefers-reduced-motion: reduce)').matches ? 'still' : 'motion'
      ].join(' ');
      root.setAttribute('data-field-snapshot-key', key);
      var unwatch = function () {
        observer.disconnect();
        removeEventListener('resize', forget);
      };
      var forget = function () {
        if (size() === sizeAtKey) return;
        root.removeAttribute('data-field-snapshot-key');
        if (img) img.remove();
        unwatch();
      };
      var observer = new ResizeObserver(forget);
      observer.observe(root);
      addEventListener('resize', forget);
      root.addEventListener('${SNAPSHOT_READ_EVENT}', unwatch, { once: true });
      try {
        if (sessionStorage.getItem('${SNAPSHOT_KEY_ITEM}') !== key) return;
        var url = sessionStorage.getItem('${SNAPSHOT_IMAGE_ITEM}');
        if (!url) return;
        img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.setAttribute('data-field-snapshot', '');
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
        root.insertBefore(img, document.currentScript.nextSibling);
        // 数えるのはタブが表に出てから（裏で開いたタブでは、本物は表に出るまで描かれない）。
        var giveUp = function () { setTimeout(function () { img.remove(); }, ${SNAPSHOT_GIVE_UP_MS}); };
        if (document.hidden) document.addEventListener('visibilitychange', giveUp, { once: true });
        else giveUp();
      } catch (e) {}
    })(document.currentScript && document.currentScript.parentElement);
  `;

/** Claude Design に同期する形。前回の絵を敷くスクリプトは出さない。 */
export default function NemophilaField(props: NemophilaFieldProps) {
  return renderField(props, false);
}

/**
 * **ラッパー（NemophilaField.astro）専用。同期しない**（.design-sync/entry.ts は default だけを書き出す）。
 * 前回の絵を敷くスクリプトを root の最初の子に出す。絵を外すラッパーのスクリプトと組でしか使わない。
 */
export function NemophilaFieldWithSnapshot(props: NemophilaFieldProps) {
  return renderField(props, true);
}

function renderField(
  { lede, state = 'day', scheduleHref = '#schedule', className, children, ...rest }: NemophilaFieldProps,
  snapshot: boolean,
) {
  return (
    // data-field・data-state はラッパーのスクリプトと、ほかのコンポーネントの :has() が探す口なので、渡された属性より後に書く。
    <section className={cx(styles.root, className)} {...rest} data-field="" data-state={state}>
      {snapshot && <script dangerouslySetInnerHTML={{ __html: SNAPSHOT_SCRIPT }} />}
      {/* 絵だけ。読み上げには何も足さない。 */}
      <canvas className={styles.canvas} aria-hidden="true" data-field-canvas=""></canvas>
      <div className={cx(styles.dof, styles.dofFar)} aria-hidden="true"></div>
      <div className={cx(styles.dof, styles.dofNear)} aria-hidden="true"></div>
      <div className={styles.light} aria-hidden="true"></div>
      <div className={styles.stars} aria-hidden="true"></div>

      <div className={cx(styles.copy, 'container')}>
        {children}
        <p className={styles.lede}>{lede}</p>
      </div>

      {/* 3状態ぶんを全部書いておき、見せるのは今の状態の1つだけ（CSS）。
          JS が無ければ、ビルド時に書いた状態のものが出る。
          文言に日時や配信タイトルを書かない — 知らないことは書かない（docs/CONCEPT.md §5）。 */}
      <a className={styles.status} data-for="day" href={scheduleHref}>
        <span className={styles.dot} aria-hidden="true"></span>
        <b>今週の配信予定</b>
        <span className={styles.go}>
          <span className={styles.goLong}>スケジュールを</span>見る
        </span>
      </a>
      <a className={styles.status} data-for="soon" href={OFFICIAL.youtube} target="_blank" rel="noopener noreferrer">
        <span className={styles.dot} aria-hidden="true"></span>
        <b>まもなく配信</b>
        <span className={styles.go}>YouTube で待つ ↗</span>
        <span className="sr-only">（外部サイトを新しいタブで開く）</span>
      </a>
      <a className={styles.status} data-for="live" href={OFFICIAL.youtube} target="_blank" rel="noopener noreferrer">
        <span className={styles.dot} aria-hidden="true"></span>
        <b>配信中</b>
        <span className={styles.go}>YouTube で見る ↗</span>
        <span className="sr-only">（外部サイトを新しいタブで開く）</span>
      </a>

      {/* 5秒を超えて自動で動き続けるので、止める手段が要る（WCAG 2.2.2）。畑が描けたときだけ出す。
          止めるのは WebGL の畑（そよぎ・なぞったときの風・叩いたときの波紋）。帯はもともと動かない。
          aria-pressed が true のとき「止めている」。 */}
      <button type="button" className={styles.pause} hidden aria-pressed="false" data-field-pause="">
        <svg className={styles.iconPause} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M7 5h3.5v14H7zm6.5 0H17v14h-3.5z" fill="currentColor"></path>
        </svg>
        <svg className={styles.iconPlay} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8 5v14l11-7z" fill="currentColor"></path>
        </svg>
        <span className="sr-only">畑の動きを止める</span>
      </button>
    </section>
  );
}
