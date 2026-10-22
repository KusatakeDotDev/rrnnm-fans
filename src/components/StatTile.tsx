/**
 * 数字を大きく見せる白いタイル。docs/DESIGN.md §5「数字を効かせる」。
 *
 * 素材が使えない分、数字がこのサイトの絵になる。
 * 値は**値があるときも無いときも** FieldValue.tsx に渡す。
 * 片方だけ自分で書くと、FieldValue を直したときにここだけ追従しなくなる。
 * この span が持つのは大きさと配置だけ。
 *
 * 下の3つ以外の属性（`className`・`id`・`aria-*` など）は root の div にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx';
import FieldValue from './FieldValue.tsx';
import styles from './StatTile.module.css';

interface StatTileProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'dangerouslySetInnerHTML'> {
  /** 上に出す欄名。例: "企画アーカイブ" */
  label: string;
  /** 大きく出す値。未確認は `null`。 */
  value?: string | null;
  /** 値の下に出す短い説明。 */
  note?: string;
}

export default function StatTile({ label, value, note, className, ...rest }: StatTileProps) {
  return (
    <div className={cx(styles.root, 'on-paper', className)} {...rest}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>
        <FieldValue value={value} />
      </span>
      {note && <span className={styles.note}>{note}</span>}
    </div>
  );
}
