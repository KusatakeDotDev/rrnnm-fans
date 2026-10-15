/**
 * 見出しのステッカー（ADR-0010「形 — ステッカー」）。淡い面のピルに濃紺の枠、少し傾ける。
 *
 * 面の色は淡いピンクかラベンダー（どちらも本文色が AA）。
 *
 * 下の2つ以外の属性（`className`・`id`・`aria-*` など）は root の h2 にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 * `style` を渡すと、傾き（`--tilt`）と一緒に当たる。
 */
import type { CSSProperties, HTMLAttributes } from 'react';

import { cx } from '../lib/cx';
import styles from './StickerHeading.module.css';

interface StickerHeadingProps extends Omit<HTMLAttributes<HTMLHeadingElement>, 'dangerouslySetInnerHTML'> {
  /** 面の色。 */
  tone?: 'pink' | 'lavender';
  /** 傾き（deg）。 */
  tilt?: number;
}

export default function StickerHeading({ tone = 'pink', tilt = -4, className, style, ...rest }: StickerHeadingProps) {
  return (
    <h2
      className={cx(styles.sticker, styles[tone], className)}
      style={{ '--tilt': `${tilt}deg`, ...style } as CSSProperties}
      {...rest}
    />
  );
}
