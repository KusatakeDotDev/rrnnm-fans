/**
 * 値が1つ入る場所。値があれば等幅で出し、無ければ「未確認」チップを出す。
 *
 * 「値があるはずの場所に未確認を出す」（docs/DESIGN.md §2 表示規約）を
 * **1箇所に閉じるためのコンポーネント**。ページ側で `value ?? '未確認'` と書き始めると、
 * 書いた人ごとに見た目が割れる。
 *
 * **ほかの属性は受け取らない。** 値の有無で root の要素が替わる（値の span か、UnknownChip か）ので、
 * 渡した属性がどちらに付くかが呼び出し側から読めなくなる（docs/adr/0011「props の決まり」の例外）。
 */
import { cx } from '../lib/cx';
import styles from './FieldValue.module.css';
import UnknownChip from './UnknownChip.tsx';

interface FieldValueProps {
  /**
   * 未確認は `null`。「この欄が無い」ではなく「値がまだ無い」を表す。
   * **空文字も未確認**。「確認できて、かつ空」という状態はこのサイトには無い
   * （docs/DESIGN.md §2 の表示規約が区別するのは値の有無だけ）ので、
   * 空文字を「確認済みの空欄」として通す口は開けない。
   */
  value?: string | null;
  /** 未確認のときにチップへ出す欄名。例: "尺" */
  field?: string;
}

export default function FieldValue({ value, field }: FieldValueProps) {
  return value ? (
    <span className={cx(styles.root, 'tabular')}>{value}</span>
  ) : (
    <UnknownChip field={field} />
  );
}
