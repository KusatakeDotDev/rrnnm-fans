/**
 * 再生リストのタイル（ADR-0008「サムネイル表示の可否」、ADR-0010「再生リスト — カルーセルをやめてタイルの格子に」）。
 * 仕事は本家への送客（docs/CONCEPT.md §4 柱9）。
 *
 * **素の状態で全件の格子（手書きの名前と自作の花）を描く。** スクリプトが動かない・oEmbed が取れないときも、全件読めるようにするため
 * （ADR-0008「名前と表紙は、ブラウザで取る」）。JS はそこへ「本家の今の名前と表紙・順序のシャッフル・
 * 狭い画面での畳み（先頭6件＋すべて見るボタン）」を足すだけで、中身を隠さない。
 *
 * **このファイルは見た目だけ。** 振る舞いのスクリプトはラッパーの PlaylistGrid.astro にある
 * （ADR-0011「スクリプトの扱い」）。スクリプトは要素を `data-playlists*` で探す。**クラス名では探さない** —
 * ここのクラス名は CSS Modules でビルドごとの名前になる。スクリプトが付けるマーカー（`is-collapsible`・`is-expanded`）だけは
 * そのままの名前で、CSS が `:global()` で読む。
 *
 * 出典は格子の下で1回だけ言い、タイルはサムネイルと名前だけにする（ADR-0008「サムネイル表示の可否」。
 * 行き先を画面に書かないことは「出典の行」）。
 *
 * タイルの色と傾きは位置に付くので、並びを混ぜても色の並びは崩れない。
 * 最後の1枚はチャンネルへのタイルで、混ぜる対象に入れない。
 *
 * 見出しは `heading` で受け、格子の上に置く。置く面と階層はページ側が決める。
 * それ以外の属性（`className` など）は root の section にそのまま渡す（ADR-0011「props の決まり」）。
 */
import { useId, type HTMLAttributes, type ReactNode } from "react";

import { cx } from "../lib/cx";
import Flower from "./Flower.tsx";
import { OFFICIAL } from "../data/official";
import styles from "./PlaylistGrid.module.css";
import { PLAYLISTS, playlistUrl } from "../data/playlists";
import YouTubeThumbnail from "./YouTubeThumbnail.tsx";

interface PlaylistGridProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "dangerouslySetInnerHTML"
> {
  /** 読み上げでのこの一覧の名前。 */
  label?: string;
  /** 見出し。格子の上に置く。 */
  heading?: ReactNode;
}

export default function PlaylistGrid({
  label = "YouTube の再生リスト",
  heading,
  className,
  ...rest
}: PlaylistGridProps) {
  // 「すべて見る」の aria-controls が指す先。1ページに2つ置いても重ならないよう、固定の名前にしない。
  const listId = useId();
  return (
    // data-playlists はラッパーのスクリプトが探すマーカーなので、残りの属性の後ろに置いて上書きさせない。
    <section className={cx(styles.root, className)} aria-label={label} {...rest} data-playlists="">
      <div className={styles.body}>
        <div className={styles.head}>{heading}</div>

        <ul className={styles.grid} id={listId} role="list" data-playlists-list="">
          {PLAYLISTS.map((playlist) => (
            <li key={playlist.id} data-playlists-item="">
              <a
                className={styles.tile}
                href={playlistUrl(playlist.id)}
                target="_blank"
                rel="noopener noreferrer"
                data-playlists-tile=""
              >
                {/* 表紙はスクリプトがこの枠に足す。読み込むまでと、JS が無いときは花が見える。 */}
                <YouTubeThumbnail>
                  <Flower size="var(--flower-size)" />
                </YouTubeThumbnail>
                {/* JS が無いとき・取れなかったときは手書きの名前。スクリプトが本家の今の名前に替える。 */}
                <span className={styles.title} data-playlists-title="">
                  {playlist.label}
                </span>
                {/* 行き先は画面には書かない（表紙と最後のタイルで分かる）。ただし、リンクの一覧から
                    文脈なしに飛んでくる読み上げの人には、リンクごとに要る。 */}
                <span className="sr-only">
                  （YouTube の再生リスト。外部サイトを新しいタブで開く）
                </span>
              </a>
            </li>
          ))}
          <li className={styles.channel}>
            <a
              className={styles.tile}
              href={OFFICIAL.youtube}
              target="_blank"
              rel="noopener noreferrer"
              data-playlists-tile=""
            >
              <YouTubeThumbnail>
                <Flower size="var(--flower-size)" />
              </YouTubeThumbnail>
              <span className={styles.title}>チャンネルを見る ↗</span>
              <span className="sr-only">（YouTube。外部サイトを新しいタブで開く）</span>
            </a>
          </li>
        </ul>

        {/* 狭い画面で畳んだときだけ出す。JS が無ければ畳まないので、最初から hidden。 */}
        <button
          type="button"
          className={styles.more}
          hidden
          aria-controls={listId}
          aria-expanded="false"
          data-playlists-more=""
        >
          {`すべての再生リスト（${PLAYLISTS.length}）を見る`}
        </button>

        {/* 出典。根拠（docs/CONCEPT.md §2・§3）と、置き場所・中身・読み上げの補足の理由は ADR-0008「出典の行」。
            「出典：YouTube 」は1つの文字列で渡す（ADR-0011「props の決まり」）。改行をまたぐと末尾の空白が落ち、
            `{' '}` で足すと文字と並んで React が間に `<!-- -->` を挟む。
            data-playlists-source は、出典の行があることをテストが探すマーカー。文言は探さない。スクリプトは読まない。 */}
        <p className={styles.source} data-playlists-source="">
          {"出典：YouTube "}
          <a href={OFFICIAL.youtube} target="_blank" rel="noopener noreferrer">
            瑠璃野ねも
            <span className="sr-only">（YouTube チャンネル。外部サイトを新しいタブで開く）</span>
          </a>
        </p>
      </div>
    </section>
  );
}
