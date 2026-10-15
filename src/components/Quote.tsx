/**
 * 引用。**出典なしでは置けない形にしてある。**
 *
 * 引用が成り立つ条件のうち、コンポーネントの側で守れるのは2つだけ:
 *   - 明瞭区分性 … 地の文と見た目で分ける（`<blockquote>` ＋ 縦罫）
 *   - 出典の明示 … label / retrieved と出典または関連作品の url を**必須**にする
 * 残る2つ（引用の必然性・主従関係）はページ側の責任で、コンポーネントでは守れない。
 * だから props を省略可能にしない。出典を書く気が無いなら、そもそも引用にしない。
 *
 * url / label / retrieved は docs/DESIGN.md §2 の `Source` 型と同じ形で受け取る。
 * 既定では Source と同じく retrieved は確認日、url は引用元になる。
 * sourceKind="provided" では retrieved は資料受領日、url は関連作品のリンクになる。
 * この場合は出典名をリンクなしで示し、blockquote の cite を付けない。原典確認済みを意味しない。
 *
 * **短く引くこと。** 全文の転載は禁止事項（docs/CONCEPT.md §5）で、
 * 説明文全文はリポジトリに保存もしない（docs/OPERATIONS.md §2）。
 *
 * 子（引いた文）は `<blockquote>` に入る。引用用propsと子以外の属性（`className`・`id`・`aria-*` など）は
 * root の figure にそのまま渡す（docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx';
import styles from './Quote.module.css';

interface QuoteProps extends Omit<HTMLAttributes<HTMLElement>, 'dangerouslySetInnerHTML'> {
  /** 引用元のURL。提供資料の場合は出典ではなく関連作品のURL。 */
  url: string;
  /** 出典の名前。例: "公式YouTubeチャンネル 概要欄" */
  label: string;
  /** 確認日または資料受領日（YYYY-MM-DD）。sourceKindで区別する。 */
  retrieved: string;
  sourceKind?: 'provided';
}

export default function Quote({ url, label, retrieved, sourceKind, children, className, ...rest }: QuoteProps) {
  const provided = sourceKind === 'provided';
  return (
    <figure className={cx(styles.quote, className)} {...rest}>
      <blockquote className={styles.text} cite={provided ? undefined : url}>
        {children}
      </blockquote>
      <figcaption className={styles.source}>
        {'出典: '}
        {/* 文字列は1つにまとめて渡す。`{label} ↗` と書くと React が間に `<!-- -->` を挟んで
            テキストが2つに割れ、字の並べ方（アンチエイリアス）が変わる。 */}
        {provided ? label : <a href={url} target="_blank" rel="noopener noreferrer">
          {`${label} ↗`}
          <span className="sr-only">（外部サイトを新しいタブで開く）</span>
        </a>}
        <span className="tabular">{`（${retrieved} ${provided ? '資料受領' : '確認'}）`}</span>
        {provided && <><br /><a href={url} target="_blank" rel="noopener noreferrer">
          関連する作品ページ ↗<span className="sr-only">（外部サイトを新しいタブで開く）</span>
        </a></>}
      </figcaption>
    </figure>
  );
}
