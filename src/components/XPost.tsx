/**
 * X のポストの埋め込みの箱（ADR-0014「埋め込みのコードは、ブラウザで oEmbed から取る」）。
 * 中身は X が差し込む（oEmbed が返す blockquote と、widgets.js が描く要素）ので、その見た目もここで持つ。
 * 埋め込みのコードを取るスクリプトと widgets.js は、ラッパー（XPost.astro）にある。ラッパーを通さずに置くと箱だけになり、
 * 中身は置く側のスクリプトが入れる（未公開の /skeb/ のダイアログ。ADR-0022）。
 *
 * 下の2つと `className` 以外の属性（`data-*` など）は root の div にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from "react";

import { cx } from "../lib/cx";
import styles from "./XPost.module.css";

interface XPostProps extends Omit<HTMLAttributes<HTMLDivElement>, "dangerouslySetInnerHTML"> {
  /** 置く地。`ground`（青い地の上）では、差し込まれた引用に白い面を敷く。 */
  on?: "paper" | "ground";
  /** widgets.js が描いた埋め込みを、中央に置く。 */
  centered?: boolean;
}

export default function XPost({ on = "paper", centered = false, className, ...rest }: XPostProps) {
  return (
    <div
      className={cx(
        styles.root,
        on === "ground" && styles.ground,
        centered && styles.centered,
        className,
      )}
      {...rest}
    />
  );
}
