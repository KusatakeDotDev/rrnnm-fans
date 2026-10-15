/**
 * 全ページ共通のフッター。**非公式表記4箇所のうちの1つ**（Issue rurino-nemo-fansite#7）。
 *
 * 文言は docs/CONCEPT.md §2 の常時表示文言（どんな場合も外さない）。
 *
 * **グラデーションの上の白い文字は axe が測れない**（incomplete に落ちて素通りする）ので、
 * 背景色にも濃紺を敷いておき、白と両端の色との比は tests/unit/palette.test.ts が見る
 * （帯の青 6.78 / 濃紺 13.21）。
 *
 * **公式アカウントへのリンクはここが持つ**（docs/CONCEPT.md §4 柱9 / Issue rurino-nemo-fansite#24。tests/conformance/official-links.spec.ts）。
 * 並びはチャンネル概要欄のリンク集と同じ（YouTube 本体の後に X・マシュマロ・BOOTH）。
 *
 * **アイコンだけで、アプリアイコンのように同じ大きさの角丸の正方形に揃えて並べる。**
 * アイコンは各サービスの公式配布物を無改変で置いたもの
 * （public/brand/NOTICE.txt。条件の一覧は docs/BRAND_ASSETS.md）。
 *
 * 基準は BOOTH。配布物のアイコン自体が赤い角丸の正方形（角の半径は一辺の 212/1024）なので、
 * **BOOTH にはこちらで何も足さない**（「ロゴを使った独自ボタンの作成」「他要素との合成」の禁止）。
 * ほかの3つは、同じ大きさ・同じ角丸の下地に載せて形を合わせる。下地の色は各社のアプリアイコンの地
 * （YouTube 白・X 黒・マシュマロは公式 GIF が想定するピンク）。
 *
 * 条件を守るために、次のことをしない:
 *   - 縁取り・影・変形・色替え。ホバーでも色や透明度を変えない
 *   - 余白を削る。BOOTH は四辺にアイコンの 0.25 倍（並びの間隔がそれを持つ）。
 *     YouTube は三角形の幅だが、配布物のアートボードが余白込みなので、画像の枠いっぱいに出してよい
 *
 * **「このサイトについて」と「お問い合わせ」は /about への入口だけを置く。** 素材のクレジット・サムネイルの
 * 出どころ・削除・訂正の窓口（docs/CONCEPT.md §2）は /about に書く（src/pages/about.astro）。
 * 全ページに出るので、どのページからでも1回で窓口に届く（tests/conformance/contact.spec.ts）。
 * フッターに全文を並べると長くなる。
 * 入口はサイトの段（区切りの上）に置く。公式の段に並べると、本人のサイトの案内に見える。
 *
 * 属性（`className`・`id`・`aria-*` など）は root の footer にそのまま渡す
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
import type { CSSProperties, HTMLAttributes } from 'react';
import { BRAND_BOOTH, BRAND_MARSHMALLOW, BRAND_X, BRAND_YOUTUBE, LOGO_WHITE_OUTLINED } from '@site-assets';

import { cx } from '../lib/cx';
import { OFFICIAL } from './official';
import styles from './SiteFooter.module.css';
import type { SiteLink } from '../content/siteNavigation';

type SiteFooterProps = Omit<HTMLAttributes<HTMLElement>, 'children' | 'dangerouslySetInnerHTML'> & { pageLinks?: readonly SiteLink[] };

/* サービスごとの設定はここだけに持つ。スタイルは SiteFooter.module.css の1つのルールで、値はカスタムプロパティで渡す。
     tile  … タイルの下地。各社のアプリアイコンの地に寄せる（色はトークン）。
             BOOTH は配布物そのものが赤い角丸の正方形なので、下地を足さない（transparent）
     scale … アイコンを収める正方形の一辺。タイルの一辺に対する比。
             YouTube の SVG は四方に余白を含むので 1（タイルの幅いっぱい）
   width/height は画像の縦横比で、読み込み前の場所取り用。 */
const links = [
  { label: 'YouTube', href: OFFICIAL.youtube, icon: BRAND_YOUTUBE, width: 602, height: 516, tile: 'var(--color-fill-brand-youtube)', scale: 1 },
  { label: 'X', href: OFFICIAL.x, icon: BRAND_X, width: 1200, height: 1227, tile: 'var(--color-fill-brand-x)', scale: 0.5 },
  { label: 'マシュマロ', href: OFFICIAL.marshmallow, icon: BRAND_MARSHMALLOW, width: 311, height: 311, tile: 'var(--color-fill-brand-marshmallow)', scale: 0.8 },
  { label: 'BOOTH', href: OFFICIAL.booth, icon: BRAND_BOOTH, width: 1024, height: 1024, tile: 'transparent', scale: 1 },
];

const chain = [
  { size: 0.5, tone: styles.lavender },
  { size: 0.75, tone: styles.petal },
  { size: 1, tone: styles.lavender },
  { size: 1.375, tone: styles.ground },
  { size: 1, tone: styles.lavender },
  { size: 0.75, tone: styles.petal },
  { size: 0.5, tone: styles.lavender },
];

/* 花の形は Flower.tsx と別に持つ。あちらは色を1つも書かないコンポーネントで芯も同じ色を薄く重ねるが、
   ここは芯を白く抜く（Claude Design のフッターあしらい案 2f）。花弁の比率もその案に合わせてある。 */
const petals = [0, 72, 144, 216, 288];

export default function SiteFooter({ pageLinks = [], className, ...rest }: SiteFooterProps) {
  return (
    <footer className={cx(styles.footer, className)} {...rest}>
      <div className={styles.edge} aria-hidden="true"></div>
      <div className={styles.body}>
        {/* width/height はヘッダーのロゴと同じ値（直すときは SiteHeader.tsx の img の脇のコメント）。 */}
        <img
          className={styles.logo}
          src={LOGO_WHITE_OUTLINED}
          loading="lazy"
          width="552"
          height="138"
          alt="rrnnm.fans（非公式）"
        />
        <p className={styles.notice}>
          当サイトは瑠璃野ねもさんを応援する非公式サイトです。ご本人・関係者とは一切関係がありません。
        </p>
        {/* 末尾の / まで書く。/about は /about/ へのリダイレクトを1回挟む（dist は about/index.html）。
            /about を開いているときも aria-current は付けない。フッターは今のページを知らず、
            そのためだけに props を足すほどではない。
            #contact は about.astro の見出しの id。定数にはせず、contact.spec.ts が全ページからたどって見る。
            aria-label は、下の公式アカウントのリストと並ぶので、リスト単位で移動する読み上げでもどちらか分かるように。
            TODO(RRNNM-33): ほかの内部リンクの行き先を全ルートで見る規約テストを足す。 */}
        <ul className={styles.siteLinks} aria-label="このサイト" role="list">
          <li>
            <a href="/">トップ</a>
          </li>
          {pageLinks.map((link) => <li key={link.href}><a href={link.href}>{link.label}</a></li>)}
          <li>
            <a href="/references/">推し活の資料</a>
          </li>
          <li>
            <a href="/about/">このサイトについて</a>
          </li>
          <li>
            <a href="/about/#contact">お問い合わせ</a>
          </li>
        </ul>

        {/* ここから公式アカウントの段。「一切関係がありません」の直後にアイコンが並ぶと、
            このサイト自身の SNS に見える。あしらいで段を切り、見出しで「誰の」を言う。
            あしらいはネモフィラの小花の連なり（docs/DESIGN.md §5「5弁花を罫線や区切りとして使う」）。
            花は自然物なので自分で描ける（docs/CONCEPT.md §3）。 */}
        <div className={styles.divider} aria-hidden="true">
          <span className={styles.rule}></span>
          {chain.map((flower, i) => (
            <svg
              key={i}
              className={flower.tone}
              style={{ width: `${flower.size}rem`, height: `${flower.size}rem` }}
              viewBox="-50 -50 100 100"
              focusable="false"
            >
              {petals.map((angle) => (
                <ellipse key={angle} cx="0" cy="-25" rx="17" ry="25" transform={`rotate(${angle})`} />
              ))}
              <circle className={styles.heart} r="13" />
            </svg>
          ))}
          <span className={cx(styles.rule, styles.ruleEnd)}></span>
        </div>

        {/* id で結ばないのは、コンポーネント一覧がフッターをもう1つ置いて id が重なるため。
            読み上げでもこの見出しの直後にリストが来る。 */}
        <p className={styles.linksHeading}>瑠璃野ねも 公式アカウント<span className={styles.externalNote}>外部サイト・新しいタブで開きます</span></p>
        {/* aria-label は、リスト単位で移動する読み上げでも「誰のアカウントか」が伝わるように。
            見出しと id で結ばないのは上のとおり（id が重なる）。 */}
        <ul className={styles.links} aria-label="瑠璃野ねも 公式アカウント">
          {links.map((link) => (
            <li key={link.label}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ '--tile-bg': link.tile, '--icon-scale': link.scale } as CSSProperties}
              >
                {/* loading="lazy" にしない。数 KB しかなく、遅らせると色だけの空タイルが先に出る。 */}
                <img src={link.icon} width={link.width} height={link.height} alt={link.label} />
                <span className="sr-only">（外部サイトを新しいタブで開く）</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
