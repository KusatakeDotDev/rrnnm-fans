/**
 * 全ページ共通のヘッダー。**非公式表記4箇所のうちの1つ**（Issue rurino-nemo-fansite#7）。
 *
 * ページ側には置かない。レイアウト（src/layouts/Base.astro）にだけ置く。
 * ページ側に書くと、後から足したページで漏れる。
 *
 * `pageLinks` を渡すと、下層ページにナビを置く（ADR-0015「ナビは下層ページの白い帯にだけ置く」）。公式アカウントへのリンクはフッターが持つ。
 * **非公式表記はロゴの中の「非公式」のラベルが担う。**
 * 画像なので、alt にも「非公式」を入れる（画像が出ない環境・読み上げでも伝わるように）。
 *
 * **`overlay` を付けると、下の段（トップの畑）の上に重なる**（ADR-0010「ヒーロー — 畑はそのまま、上に乗るものを組み直す」）。
 * ロゴを畑のコンポーネントに入れず、ここに置いたままにするのは、ヘッダーの非公式表記を
 * ページごとに書かせないため（tests/conformance/routes.spec.ts）。
 * 畑が配信中（夜）のあいだは、ロゴを白抜き版に替える（夜空で濃紺の文字は読めない）。
 *
 * **`paper` を付けると、ロゴを白い帯に置く**（下層ページ。docs/DESIGN.md §3「レイアウト方針」）。
 * 帯はこの下のページの見出し（Base.astro の head スロット）と続けて見せ、本文との区切りの線は見出しの側が引く。
 * `overlay` と両方渡したら `overlay` を採る（畑の上に白い帯を重ねない）。
 *
 * `overlay`・`paper` 以外の属性（`className`・`id`・`aria-*` など）は root の header にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { HTMLAttributes } from "react";
import { LOGO_OUTLINED, LOGO_WHITE_OUTLINED } from "@site-assets";

import { cx } from "../lib/cx";
import styles from "./SiteHeader.module.css";
import type { SiteLink } from "../data/site-navigation";

interface SiteHeaderProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "dangerouslySetInnerHTML"
> {
  /** 下の段に重ねる（トップだけ）。 */
  overlay?: boolean;
  /** ロゴを白い帯に置く（下層ページ）。`overlay` と両方なら `overlay` を採る。 */
  paper?: boolean;
  pageLinks?: readonly SiteLink[];
}

export default function SiteHeader({
  overlay = false,
  paper = false,
  pageLinks = [],
  className,
  ...rest
}: SiteHeaderProps) {
  const onPaper = paper && !overlay;
  return (
    <header
      className={cx(styles.root, "container", onPaper && "on-paper", className)}
      {...rest}
      data-overlay={overlay ? "" : undefined}
      data-paper={onPaper ? "" : undefined}
    >
      <a className={styles.brand} href="/">
        {/* width/height はロゴの SVG（public/logo/）の縦横比。縦横比の変わるロゴに差し替えたら、下の白抜き版と
            SiteFooter.tsx の img も同じ値に直す。差し替えはまれで、そのためだけに定数のファイルを足すほどではない。 */}
        <img
          className={styles.logo}
          src={LOGO_OUTLINED}
          width="552"
          height="138"
          alt="rrnnm.fans（非公式）"
        />
        {overlay && (
          /* 隠れている間（夜の畑の上以外）も読み込まれる（display: none でも <img> は取りに行く）。
             loading="lazy" は付けない。付けると隠れている間は読み込まれず、その画像の decode() が
             いつまでも終わらない。同期のスクリーンショット比較（.design-sync/NOTES.md）がそこで止まった。
             スクリーンショット比較のスクリプトは同期の道具のもの（.ds-sync/ に毎回入れる）で、このリポジトリでは直せない。
             代わりに、トップを開くたびにこの SVG（6.5KB）を1回余分に取りに行くことを受け入れた（PR rurino-nemo-fansite#113）。 */
          <img
            className={cx(styles.logo, styles.logoWhite)}
            src={LOGO_WHITE_OUTLINED}
            width="552"
            height="138"
            alt="rrnnm.fans（非公式）"
          />
        )}
      </a>
      {onPaper && pageLinks.length > 0 && (
        <nav className={styles.nav} aria-label="サイト内ナビゲーション">
          {pageLinks.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
