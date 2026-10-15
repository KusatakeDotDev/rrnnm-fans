/**
 * 企画の分類バッジ（docs/DESIGN.md §3）。
 *
 * **面の色と文字色は組でしか使えない。** 濃い面には白、淡い面には本文色。
 * 組を崩すと必ず AA を割るので、その判断をページ側に渡さずここに閉じてある
 * （tone を選ぶだけで文字色は自動で決まる）。
 *
 * 見た目は1文字の略号だけ。分類名そのものは .sr-only で読み上げに残す。
 * 略号だけだと、色が見えない読者には何の分類か伝わらない。
 *
 * 下の3つ以外の属性（`className`・`id`・`aria-*` など）は root の span にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx';
import styles from './CategoryBadge.module.css';
import type { Tone } from './tones';

interface CategoryBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'dangerouslySetInnerHTML'> {
  /** 丸の中に出す略号。1文字を想定している。 */
  abbr: string;
  /** 分類名。画面には出ないが読み上げには出る。 */
  label: string;
  tone?: Tone;
}

export default function CategoryBadge({ abbr, label, tone = 'violet', className, ...rest }: CategoryBadgeProps) {
  return (
    <span className={cx(styles.badge, className)} {...rest} data-tone={tone}>
      <span aria-hidden="true">{abbr}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
