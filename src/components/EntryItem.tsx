/**
 * 一覧の1行。分類バッジ ＋ タイトル ＋ 値。EntryList.tsx の中に置く。
 *
 * 値は FieldValue.tsx に渡すので、未確認のときの見た目はここでは決めない。
 *
 * 下の props 以外の属性（`className`・`id`・`aria-*` など）は root の li にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx';
import CategoryBadge from './CategoryBadge.tsx';
import styles from './EntryItem.module.css';
import FieldValue from './FieldValue.tsx';
import type { Tone } from './tones';

interface EntryItemProps extends Omit<HTMLAttributes<HTMLLIElement>, 'title' | 'children' | 'dangerouslySetInnerHTML'> {
  title: string;
  /** 付ければタイトルがリンクになる。 */
  href?: string;
  /** バッジの略号。label と対で指定する。 */
  abbr?: string;
  /** 分類名。読み上げ用。 */
  category?: string;
  tone?: Tone;
  /**
   * 右端に出す値。**`null` は「未確認」**、省略は「この行に値の欄が無い」。
   * 2つは違う状態なので、片方をもう片方で表さない（docs/DESIGN.md §2）。
   */
  value?: string | null;
  /** 未確認のときにチップへ出す欄名。例: "尺" */
  valueField?: string;
}

export default function EntryItem({ title, href, abbr, category, tone, value, valueField, className, ...rest }: EntryItemProps) {
  const hasValueColumn = value !== undefined || valueField !== undefined;

  return (
    <li className={cx(styles.root, className)} {...rest}>
      {abbr && category && <CategoryBadge abbr={abbr} label={category} tone={tone} />}
      <span className={styles.title}>{href ? <a href={href}>{title}</a> : title}</span>
      {hasValueColumn && <FieldValue value={value} field={valueField} />}
    </li>
  );
}
