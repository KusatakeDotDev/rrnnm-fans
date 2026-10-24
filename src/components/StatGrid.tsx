/**
 * 数字タイルを並べるコンテナ。中身は StatTile.tsx。
 *
 * `className` 以外の属性（`id`・`aria-*`・`data-*` など）は root の div にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from "react";

import { cx } from "../lib/cx";
import styles from "./StatGrid.module.css";

type StatGridProps = Omit<HTMLAttributes<HTMLDivElement>, "dangerouslySetInnerHTML">;

export default function StatGrid({ className, ...rest }: StatGridProps) {
  return <div className={cx(styles.root, className)} {...rest} />;
}
