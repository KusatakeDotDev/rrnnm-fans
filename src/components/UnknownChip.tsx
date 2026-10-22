/**
 * 「未確認」チップ。docs/DESIGN.md §2 表示規約 / Issue rurino-nemo-fansite#14。
 *
 * このサイトは**未確認のデータが大量にある状態で始まる**。空欄にすると壊れて見えるし、
 * 憶測で埋めるのは禁止事項（docs/CONCEPT.md §5）。だから「未確認」を隠さず、
 * 一級の状態として出す。**破線・低彩度・小さめ**が規約で決まっている見た目。
 *
 * `confidence`（出典の質・エントリ全体にかかる）とは別の軸。混ぜない。
 *
 * `field` 以外の属性（`className`・`id`・`aria-*` など）は root の span にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx';
import styles from './UnknownChip.module.css';

interface UnknownChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'dangerouslySetInnerHTML'> {
  /** 何が未確認かを前に付ける。例: "尺" → 「尺 未確認」 */
  field?: string;
}

export default function UnknownChip({ field, className, ...rest }: UnknownChipProps) {
  return (
    <span className={cx(styles.root, className)} {...rest}>
      {field ? `${field} 未確認` : '未確認'}
    </span>
  );
}
