/**
 * 蝶。自作SVG（Issue rurino-nemo-fansite#6 / docs/DESIGN.md §5）。
 *
 * 公式キービジュアルにも蝶はいるが、**蝶そのものは自然物**なので写しにはならない。
 * 色は `tone` で蝶の色のトークンから選ぶ。渡さなければ、花（Flower.tsx）と同じく `currentColor` で受ける。
 *
 * 下の2つ以外の属性（`className`・`id`・`data-*` など）は root の svg にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 * `style` を渡すと、幅と一緒に当たる。
 */
import type { SVGAttributes } from "react";

import { cx } from "../lib/cx";
import styles from "./Butterfly.module.css";

interface ButterflyProps extends Omit<
  SVGAttributes<SVGSVGElement>,
  "children" | "dangerouslySetInnerHTML"
> {
  /** 幅。高さは 34/40 の比で決まる。CSS の長さで書く。 */
  size?: string;
  /** 色。渡さなければ、置いた場所の文字色（currentColor）。 */
  tone?: "pink" | "violet";
}

export default function Butterfly({
  size = "1.5rem",
  tone,
  className,
  style,
  ...rest
}: ButterflyProps) {
  return (
    <svg
      className={cx(styles.root, tone && styles[tone], className)}
      style={{ width: size, ...style }}
      {...rest}
      viewBox="0 0 40 34"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="currentColor">
        <ellipse cx="13" cy="13" rx="9.2" ry="10.4" opacity="0.82" transform="rotate(-24 13 13)" />
        <ellipse cx="27" cy="13" rx="9.2" ry="10.4" opacity="0.82" transform="rotate(24 27 13)" />
        <ellipse
          cx="14.6"
          cy="24.5"
          rx="6.2"
          ry="6.8"
          opacity="0.62"
          transform="rotate(-14 14.6 24.5)"
        />
        <ellipse
          cx="25.4"
          cy="24.5"
          rx="6.2"
          ry="6.8"
          opacity="0.62"
          transform="rotate(14 25.4 24.5)"
        />
        <rect x="19.1" y="6" width="1.8" height="23" rx="0.9" />
      </g>
      <path
        d="M19.4 7 Q16.5 2.6 13.2 1.8 M20.6 7 Q23.5 2.6 26.8 1.8"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
