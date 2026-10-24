/**
 * 点線で区切られた一覧のコンテナ。中身は EntryItem.tsx。
 *
 * **件数の少ない一覧用**で、件数が増えると間延びする。企画カタログのような
 * 件数の多い一覧には案B（企画図鑑）の表形式を使う（docs/DESIGN.md §3「レイアウト方針」）。
 *
 * `className` 以外の属性（`id`・`aria-*`・`data-*` など）は root の ul にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from "react";

import { cx } from "../lib/cx";
import styles from "./EntryList.module.css";

type EntryListProps = Omit<HTMLAttributes<HTMLUListElement>, "dangerouslySetInnerHTML">;

export default function EntryList({ className, ...rest }: EntryListProps) {
  // 行頭の点を消した ul は、Safari と VoiceOver ではリストとして読まれないので、role で戻す。
  return <ul className={cx(styles.root, className)} role="list" {...rest} />;
}
