/**
 * クラス名をつなぐ。React のコンポーネント（src/components/*.tsx）が、自分のクラスと
 * 呼び出し側の `className` を1つにするのに使う（docs/adr/0011-react-components-for-design-sync.md）。
 *
 * Astro の `class:list` の代わり。受け付けるのは文字列と「無い」だけで、
 * `class:list` のオブジェクトや配列の形は持たない。コンポーネントの中では要らないため。
 * `clsx` などの依存を足さないのは ADR-0001 要件5（3年後に install が通る）のため。
 *
 * **空白は詰める。** 呼び出し側が `className=" a  b "` のように渡しても、
 * `class` 属性には名前と空白1つずつしか出さない。
 */
export function cx(...names: readonly (string | false | null | undefined)[]): string {
  return names.flatMap((name) => (typeof name === 'string' ? (name.match(/\S+/g) ?? []) : [])).join(' ');
}
