/**
 * YouTube へのリンクカードのサムネイル枠。ScheduleCard と PlaylistGrid が使う
 * （ADR-0004「サムネイル表示の可否についての判断」・ADR-0008「サムネイル表示の可否」）。
 *
 * **リンク（`<a>`）の中に置く。** ステッカーの上に乗る中の要素なので、枠自身はホバーに反応せず、押し込まない
 * （ADR-0004「出典の行に作者名を出す」・ADR-0008「サムネイル表示の可否」）。
 *
 * 中身は子で受ける。`<img>` なら枠いっぱいに 16:9 で切り抜いて敷く（hqdefault.jpg の上下の黒帯もこれで落ちる）。
 *
 * **画像は、読み込みとデコードが済んでから `img[data-loading]` を外してフェードで出す。** 途中まで描かれた画像や、
 * 花から画像へのいきなりの切り替えを見せないため。付け外しは、画像を入れる側のスクリプトが持つ
 * （ScheduleCard の `LOAD_THUMBNAIL`、PlaylistGrid の足す側のスクリプト）。同じ手順なので、片方を直したら、もう片方も合わせる。
 * 枠に持たせないのは、ScheduleCard が `src` を替えるので、2つのスクリプトで分け持つと、リスナーの順番と
 * Firefox の `decode()` の違いに頼ることになるため。
 *
 * **`<picture>` / `<source>` で「無ければ別の画像」にはできない。** `<picture>` が候補を選ぶのは形式（type）と
 * 条件（media）だけで、選んだ画像が無くても次へ落ちない。しかも YouTube は無いサムネイルに 404 と 120×90 の JPEG を返すので、`error` も起きない（2026-09-14 実測）。
 * 高解像度が無いときの切り替えは、ビルド時に schedule-oembed.ts が確かめる。
 *
 * リンクの名前は置く側が持つ。props は ADR-0011「props の決まり」。
 */
import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx';
import styles from './YouTubeThumbnail.module.css';

type YouTubeThumbnailProps = Omit<HTMLAttributes<HTMLSpanElement>, 'dangerouslySetInnerHTML'>;

export default function YouTubeThumbnail({ className, children, ...rest }: YouTubeThumbnailProps) {
  return (
    // data-youtube-thumbnail はスクリプトが足す先を探すマーカーなので、残りの属性の後ろに置いて上書きさせない。
    <span className={cx(styles.root, className)} {...rest} data-youtube-thumbnail="">
      {children}
    </span>
  );
}
