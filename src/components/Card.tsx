/**
 * 白いステッカーのカード（docs/DESIGN.md §3 / ADR-0010「形 — ステッカー」）。
 * 濃紺の太い枠・大きな角丸・ぼかしの無いずらした影。
 *
 * `.on-paper` を付けるのがこのコンポーネントの一番の仕事。地が白に変わると使える色も変わる
 * （リンクは濃紺からロゴの青へ、補助文の色が解禁される）ので、
 * **背景とリンク色は必ず一緒に動く**（src/styles/global.css）。
 * ページ側が `.on-paper` を書き忘れる余地を残さないために、形と一緒に配ってある。
 *
 * 傾きは置く側が決める（トップの配信予定は少し傾ける）。
 *
 * `className` 以外の属性（`id`・`aria-*`・`data-*` など）は root の div にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx';
import styles from './Card.module.css';

type CardProps = Omit<HTMLAttributes<HTMLDivElement>, 'dangerouslySetInnerHTML'>;

export default function Card({ className, ...rest }: CardProps) {
  return <div className={cx(styles.card, 'on-paper', className)} {...rest} />;
}
