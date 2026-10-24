/**
 * ネモフィラの5弁花。自作SVG（Issue rurino-nemo-fansite#6 / docs/DESIGN.md §5）。
 *
 * **公式素材は1点も使わない。** 花は自然物なので自分で描ける。
 * キャラクターの意匠（髪型・衣装）を写した瞬間に二次創作になる、という線引きの
 * 内側にいるためのコンポーネント（docs/CONCEPT.md §3）。
 *
 * 色は `currentColor` で受ける。置いた場所の文字色がそのまま花の色になるので、
 * このファイルには色を1つも書かない。
 *
 * `size` 以外の属性（`className`・`id`・`data-*` など）は root の svg にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { SVGAttributes } from "react";

interface FlowerProps extends Omit<
  SVGAttributes<SVGSVGElement>,
  "children" | "dangerouslySetInnerHTML"
> {
  /** 一辺の長さ。CSS の長さで書く。 */
  size?: string;
}

/** 花弁の回転角。5弁なので 360/5。 */
const petals = [0, 72, 144, 216, 288];

export default function Flower({ size = "1.5rem", style, ...rest }: FlowerProps) {
  return (
    // 飾りなので読み上げない。aria-hidden・focusable は残りの属性の後ろに置いて上書きさせない。
    <svg
      style={{ width: size, height: size, ...style }}
      viewBox="0 0 40 40"
      {...rest}
      aria-hidden="true"
      focusable="false"
    >
      {petals.map((angle) => (
        <ellipse
          key={angle}
          cx="20"
          cy="10"
          rx="6.6"
          ry="8.4"
          fill="currentColor"
          transform={`rotate(${angle} 20 20)`}
        />
      ))}
      {/* 中心。同じ色を薄く重ねる。地の色を書かずに「明るい芯」を作るための書き方。 */}
      <circle cx="20" cy="20" r="4.4" fill="currentColor" fillOpacity="0.28" />
    </svg>
  );
}
