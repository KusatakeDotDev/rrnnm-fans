/**
 * 「Twitter」と書き、ホバーで「新X」と出す遊び。「新X」は、よく見る「X（旧Twitter）」を逆にしたもの。
 * 古い呼び方のまま放ってあるのではなく、わざとだと分かるようにする。**この「Twitter」の表記を X に直さない。**
 *
 * 出すのは `title` 属性だけ。スマホのタップやキーボードでは出ないが、
 * ホバーした人だけが見つける隠し要素にとどめる。「Twitter」だけでも意味は通じるので、出なくても読むのに困らない。
 * Chrome は `title` を span の説明（description）としてアクセシビリティツリーに載せる（確かめた）。
 * 読み上げソフトが「新X」も読むかは、ソフトによる（確かめていない）。読まれても「Twitter」のあとに
 * 短く足されるだけなので、`aria-hidden` などで隠さない。
 *
 * `className` などの属性（`id`・`aria-*`・`data-*` など）は root の span にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from 'react';

type TwitterProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'dangerouslySetInnerHTML' | 'title'>;

export default function Twitter(props: TwitterProps) {
  // title は残りの属性の後ろに置いて上書きさせない。children・dangerouslySetInnerHTML は型で外すだけで、
  // 実行時には取り除かない。ほかのコンポーネントと同じ形（docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
  return (
    <span {...props} title="新X">
      Twitter
    </span>
  );
}
