/**
 * 引用。**出典なしでは置けない形にしてある。**
 *
 * 引用が成り立つ条件のうち、コンポーネントの側で守れるのは2つだけ:
 *   - 明瞭区分性 … 地の文と見た目で分ける（`<blockquote>` ＋ 縦罫）
 *   - 出典の明示 … url / label / retrieved を**必須**の props にする
 * 残る2つ（引用の必然性・主従関係）はページ側の責任で、コンポーネントでは守れない。
 * だから props を省略可能にしない。出典を書く気が無いなら、そもそも引用にしない。
 *
 * props の形は docs/DESIGN.md §2 の `Source` 型に合わせてある。
 * コンテンツを src/content/ に移したとき、そのまま渡せる。
 *
 * **短く引くこと。** 全文の転載は禁止事項（docs/CONCEPT.md §5）で、
 * 説明文全文はリポジトリに保存もしない（docs/OPERATIONS.md §2）。
 *
 * 子（引いた文）は `<blockquote>` に入る。下の3つと子以外の属性（`className`・`id`・`aria-*` など）は
 * root の figure にそのまま渡す（docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx';
import styles from './Quote.module.css';

interface QuoteProps extends Omit<HTMLAttributes<HTMLElement>, 'dangerouslySetInnerHTML'> {
  /** 引用元のURL。`<blockquote cite>` にも入る。 */
  url: string;
  /** 出典の名前。例: "公式YouTubeチャンネル 概要欄" */
  label: string;
  /** 確認日（YYYY-MM-DD）。リンクが切れても「いつ時点のものか」が残る。 */
  retrieved: string;
}

export default function Quote({ url, label, retrieved, children, className, ...rest }: QuoteProps) {
  return (
    <figure className={cx(styles.root, className)} {...rest}>
      <blockquote className={styles.text} cite={url}>
        {children}
      </blockquote>
      <figcaption className={styles.source}>
        {'出典: '}
        {/* 文字列は1つにまとめて渡す。`{label} ↗` と書くと React が間に `<!-- -->` を挟んで
            テキストが2つに割れ、字の並べ方（アンチエイリアス）が変わる。 */}
        <a href={url} target="_blank" rel="noopener noreferrer">
          {`${label} ↗`}
          <span className="sr-only">（外部サイトを新しいタブで開く）</span>
        </a>
        <span className="tabular">{`（${retrieved} 確認）`}</span>
      </figcaption>
    </figure>
  );
}
