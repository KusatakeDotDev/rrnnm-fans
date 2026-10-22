/**
 * 見出しの上に置く小さな肩書き。
 *
 * 本文ではないので --text-small を使ってよい（本文の下限 16px は本文にだけかかる）。
 *
 * `className` 以外の属性（`id`・`aria-*`・`data-*` など）は root の p にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx';
import styles from './Eyebrow.module.css';

type EyebrowProps = Omit<HTMLAttributes<HTMLParagraphElement>, 'dangerouslySetInnerHTML'>;

export default function Eyebrow({ className, ...rest }: EyebrowProps) {
  return <p className={cx(styles.root, className)} {...rest} />;
}
