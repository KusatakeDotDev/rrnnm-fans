/**
 * 一覧の上に置く小見出し。
 *
 * 色は --color-accent（紫）。白地 7.86 で AA。**青い地では 4.49 なので使えない** —
 * このコンポーネントは白い面（カード）の中でだけ使う。
 * モックの色は青（#4A74C4）だが、白地 4.58 に対して紫は 7.86 で余裕があるほうを採った。
 *
 * `as` と `className` 以外の属性（`id`・`aria-*`・`data-*` など）は root の要素にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 * タグは `as` で替わるが、どれでも root は1つなので、属性の行き先は呼び出し側から読める。
 */
import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx';
import styles from './SectionLabel.module.css';

interface SectionLabelProps extends Omit<HTMLAttributes<HTMLElement>, 'dangerouslySetInnerHTML'> {
  /**
   * 見出しの階層。既定は h3。
   *
   * **h2 は選べない。** h2 は大見出しの大きさと色（--color-heading）を見に行く（global.css）ので、
   * 小さいラベルにならない。大見出しが要る場所では、このコンポーネントではなく
   * 素の `<h2>` か StickerHeading を書く。
   */
  as?: 'h3' | 'h4' | 'p';
}

export default function SectionLabel({ as: Tag = 'h3', className, ...rest }: SectionLabelProps) {
  return <Tag className={cx(styles.label, className)} {...rest} />;
}
