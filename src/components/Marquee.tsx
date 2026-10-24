/**
 * 畑の下端に重なる文字の帯。文言・読み上げない・流さないことは ADR-0010「文字の帯」。
 * 読み上げなくても、非公式だということはヘッダー・畑・フッターで読める。
 *
 * 属性（`className`・`id`・`data-*` など）は root の div にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from "react";

import { cx } from "../lib/cx";
import styles from "./Marquee.module.css";

type MarqueeProps = Omit<HTMLAttributes<HTMLDivElement>, "children" | "dangerouslySetInnerHTML">;

/**
 * 帯を繰り返す回数を決めるのに写した、Marquee.module.css の広い画面の値。写し元を変えると
 * tests/repo/css-copies.test.ts が落ちるので、そのときはここも直し、GROUP_MIN_WIDTH の元にした幅も測り直す。
 */
export const COPIED_FROM_CSS = {
  /** .ribbon の左右のはみ出し。 */
  ribbonMarginInline: "-1.25rem",
  /** .track の行頭のはみ出し。 */
  trackMarginInlineStart: "-3rem",
  /** .band の字。下の GROUP_MIN_WIDTH の 221.9px は、この字で測った。 */
  bandFontFamily: "var(--font-latin-display)",
  bandFontSize: "1.375rem",
  bandFontWeight: "700",
  bandLetterSpacing: "0.14em",
  /** .group の間と、.bead の大きさ。 */
  groupGap: "var(--space-7)",
  groupPaddingInlineEnd: "var(--space-7)",
  beadSize: "12px",
} as const;

/** 上の値が読むトークンの、GROUP_MIN_WIDTH の幅を測ったときの値（tokens.css。tests/repo/css-copies.test.ts が突き合わせる）。 */
export const MEASURED_WITH_TOKENS = {
  "--font-latin-display":
    '"Quicksand", "Zen Maru Gothic", "Zen Maru Gothic Fallback", system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Noto Sans JP", "Meiryo", sans-serif',
  "--space-7": "1.75rem",
} as const;

/**
 * 帯を届かせる幅（CSS の px）。3840px の画面を 50% に縮小した 7680px に、帯の左右のはみ出し
 * （.ribbon の margin-inline × 2）と行頭のはみ出し（.track の margin-inline-start）を足す。
 * はみ出しはルート 16px で px にした。ルートが大きいとはみ出しも広がるが、1回分のほうがずっと大きく広がるので足りる。
 */
const rem = (value: string) => {
  const match = /^-?(\d*\.?\d+)rem$/.exec(value);
  if (!match) throw new Error(`rem の長さとして読めない: ${value}`);
  return Number(match[1]) * 16;
};
export const REACH =
  3840 / 0.5 +
  rem(COPIED_FROM_CSS.ribbonMarginInline) * 2 +
  rem(COPIED_FROM_CSS.trackMarginInlineStart);

/**
 * 1回分の幅の狭いほうの見積もり。1回分は UNOFFICIAL と点1つで、幅は Marquee.module.css の .band の字と
 * .group の間・.bead の大きさ（上の COPIED_FROM_CSS）で決まる。ルート 16px・22px の字で、スタックの書体を Windows で測ると
 * 221.9〜245.3px（Zen Maru Gothic・Yu Gothic UI・Quicksand・Segoe UI・Noto Sans JP・Meiryo）。いちばん狭い 221.9px を元に、
 * さらに狭くなる理由が2つあるので、両方を掛ける。
 * - 字と間は rem なので、ブラウザの設定で文字を小さくすると比例して縮む。Chrome の設定で選べる
 *   いちばん小さい「極小」（ルート 9px）まで見込む
 * - 測っていない環境（Mac・Android など）の書体を見込んで、2割狭く見積もる。変わるのは字の部分だけだが、
 *   1回分の全体に掛けて多めに並べる（増えるのは gzip でほとんど縮む同じ要素の繰り返し）
 */
const GROUP_MIN_WIDTH = 221.9 * (9 / 16) * 0.8;

/**
 * 帯を埋める回数。いちばん広い画面でも右端まで切れ目なく並ぶだけ繰り返す。
 * 回数は手で決めず、届かせる幅を1回分の幅で割って出す。広げたいときは REACH を変える。
 * 狭い画面（40rem 以下）は字が小さく1回分も短いが、届かせる幅がずっと小さいので足りる。
 *
 * **回数を持たない作りにはしない。** SVG の pattern で1回分を敷き詰めると、1回分を画像にしてから
 * 帯の傾きで回すので、DPR 1 の画面で字がぼけた（Chromium で比べて確かめた）。CSS で埋まるまで
 * 繰り返せるのは背景・マスクなどの画像だけなので、ほかの方法でも同じになるはず（こちらは試していない）。
 */
const REPEAT = Math.ceil(REACH / GROUP_MIN_WIDTH);
const groups = Array.from({ length: REPEAT }, (_, i) => i);

export default function Marquee({ className, ...rest }: MarqueeProps) {
  return (
    <div className={cx(styles.root, className)} {...rest} aria-hidden="true">
      <div className={styles.ribbon}>
        <div className={styles.band}>
          <div className={styles.track}>
            {groups.map((i) => (
              // 末尾の空白は、CSS が効かないときに語の間で折り返させるため（無いと1語につながって横にはみ出す）。
              // .group は inline-flex なので、CSS が効けば空白だけの文字は描かれず、並びは変わらない。
              <span className={styles.group} key={i}>
                UNOFFICIAL
                <span className={styles.bead} />{" "}
              </span>
            ))}
          </div>
        </div>
        <div className={styles.edge}></div>
      </div>
    </div>
  );
}
