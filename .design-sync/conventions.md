# 瑠璃野ねも 非公式ファンサイトのコンポーネント

「ネモフィラ・ポップ」の見た目。青い地（ページ）の上に、白い面（ステッカー・タイル）を載せて組む。

## 包むもの

プロバイダーは要らない。`styles.css` を読めば、トークン（`--color-*` など）と地の見た目（`body` の青い地・見出し・リンク）が入る。コンポーネントは `window.RurinoNemo.*` から使う。

## 地と色の決まり

- **白い面を敷くときは `.on-paper` クラスを付ける。** 背景とリンク色が一緒に切り替わる。背景色だけを自分で塗ると、リンク色が青い地のままになってコントラストが落ちる。白い面の中でもう一度ページの地に戻すときは `.on-ground` を付ける
- **色は役割トークンで指す。** 生の値や `--c-*`（パレット）は使わない。役割トークンには次のものがある
  - 地: `--color-bg`、`--color-surface`
  - 文字: `--color-text`、`--color-text-muted`、`--color-heading`、`--color-figure`、`--color-link`
  - 塗り: `--color-fill-blue`、`--color-fill-violet`、`--color-fill-pink`、`--color-fill-amber`、`--color-fill-lavender`
  - 塗りの上の文字: `--color-text-on-fill`
  - 飾り: `--color-accent`、`--color-decor`、`--color-outline`、`--color-frame`
- **形もトークンで指す。**
  - 角丸: `--radius-card`、`--radius-tile`、`--radius-pill`
  - 枠: `--border-card`、`--border-sticker`
  - 影のずれ: `--offset-card`、`--offset-tile`、`--offset-pill`、`--offset-pressed`（押し込んだとき）
  - 押せるものの大きさの下限: `--tap-size`（44px）
- **余白もトークンで指す。** `--space-N` は N × 0.25rem（4px 刻み。`--space-4` が 1rem）。使うのは、トークンにある N だけ（`_ds_bundle.css` の `--space-*`）。ページ内のリンクで飛んだ先の上の余白は `--anchor-offset`
- **文字の大きさ**は `--text-small`・`--text-base`・`--text-h3`・`--text-h2`・`--text-h1`・`--text-figure`。書体は `--font-sans`・`--font-display` を使う。**Web フォントを足さない**（サイトは `--font-sans` の先頭の Zen Maru Gothic を配っている）
- **日付・尺・回数などの数字には `.tabular`** を付けて、桁の幅を揃える。**目に見せずに読み上げだけに残す文には `.sr-only`**
- **値が無い所には `FieldValue` を置く。** `value={null}` を渡すと「未確認」のチップが出る。自分で「未確認」と書かない
- 値の有無で出し分けるなら `FieldValue`。`UnknownChip` は `FieldValue` の中身（値が無いときに描くチップ）で、値が無いと決まっている所に直接置くときだけ使う

## 自分で書く CSS

- **自分で書く CSS は `@layer pages { … }` に入れる。** サイトの CSS は `base < layout < components < utilities < pages` の順のレイヤーに入っていて、順は `styles.css` から読まれる `_ds_bundle.css` の先頭で宣言している。レイヤーの外に書くと、順に関係なくコンポーネントの中の見た目まで上書きする
- **レイヤーの順を宣言し直さない**（`@layer a, b;` の形を書かない）。最初に読まれた宣言で順が決まり、コンポーネントの見た目の勝ち負けが変わる
- **コンポーネントの root に書くのは、置き方（`margin`・`position`・`top` などの位置・`z-index`・`transform`・`grid-column`・`grid-row`・`flex`・`width`・`max-width` など）だけ。** 色・余白・枠を変えるときは、そのコンポーネントの props を使う

## コンポーネントの props

- `className` と、残りの HTML 属性（`id`・`aria-*`・`data-*`）は root の要素に付く。`class` ではなく `className` で渡す
- 例外は、root の要素が条件で替わるコンポーネント（今は FieldValue と ScheduleCard）で、自分の props しか受け取らない
- `Twitter` は中身（「Twitter」）も `title`（「新X」）も決まっていて、`children`・`title` を渡しても捨てられる

## コンポーネントの使い分け

| 置くもの | コンポーネント | 書き方の要点 |
| --- | --- | --- |
| トップの一画面目 | `NemophilaField` | ネモフィラ畑。`children` に `<h1>` を入れ、句ごとに `<span>` で包む（そこで改行する）。`lede` に添え書き、`state` は `"day"`・`"soon"`・`"live"`。直後に `Marquee`（文字の帯）を置く。 |
| ページの枠 | `SiteHeader`・`SiteFooter` | 1ページに1つずつ。畑の上に重ねるときは `SiteHeader overlay`。下層ページは `SiteHeader paper`（ロゴを白い帯に置く）。その下に h1 を同じ白い帯で続け、濃紺の線で本文と区切る（h1 の上に Eyebrow は置かない。「非公式」はすぐ上のロゴが持つ） |
| 節の見出し | `StickerHeading` | 斜めに貼ったステッカーの見出し（h2）。`tone` は `"pink"`・`"lavender"`、`tilt` は傾きの度数（-4〜4くらい） |
| 小見出し・見出しの上の小さな文字 | `SectionLabel`（`as` は `"h3"`・`"h4"`・`"p"`）・`Eyebrow` | h2 には使わない。h2 は `StickerHeading`。`Eyebrow` は下層ページの h1 の上には置かない（上の「ページの枠」）。今はサイトのどのページも使っていない |
| 白い面 | `Card` | 中身は自由。影と角丸を持つ。上の縁に `StickerHeading` を重ねて置くときは `headingOverlap` を付ける（重なる分だけ上の余白を広く取る） |
| 数字を大きく見せる | `StatGrid` の中に `StatTile` を並べる | 値が無ければ `value={null}` |
| 一覧 | `EntryList` の中に `EntryItem` を並べる | `abbr` と `category`（読み上げ用の分類名）を**両方**渡すと、先頭に分類の丸（`CategoryBadge`）が付く。`tone` はその色（省略は `"violet"`）。`value={null}` は「未確認」、省略は「値の欄が無い」 |
| 引用 | `Quote` | `url`・`label`・`retrieved`（確認日 YYYY-MM-DD）は必須。出典を書かない引用は作らない |
| 飾り | `Flower`・`Butterfly` | 色は `currentColor` で受けるので、親の `color` で塗る。`Butterfly` は `tone`（`"pink"`・`"violet"`）でも塗れる。大きさは `size`（CSS の長さ） |
| 動画のサムネイル | `YouTubeThumbnail`・`PlaylistGrid`・`ScheduleCard` | YouTube が配る画像にだけ使う。ほかの画像を中に入れない |
| X のポストの埋め込み | `XPost` | サイトでは、子に置いたポストへのリンクを X の埋め込みに差し替える。見本ではリンクのまま。`on` は置く地（`"paper"`・`"ground"`）、`centered` で描いた埋め込みを中央に置く |
| 文の中の X | `Twitter` | 「Twitter」と書き、ホバーで「新X」と出す遊び。X が出る文すべてに使うものではなく、置くかは文ごとに決める（今はサイトのどのページも使っていない）。サービスを指す文に使い、人が口にした語を引くときは、コンポーネントを使わず、ふつうの文字で言ったとおりに書く（ホバーの「新X」と合わなくなるため）。`children`・`title` は渡さない（上の「コンポーネントの props」） |

**外部サービスのロゴ（YouTube・X・マシュマロ・BOOTH・Skeb）は `SiteFooter` の中にだけある。** 取り出して別の場所に置いたり、色や形を変えたりしない（各社の利用条件があるため）。

**`guidelines/docs/CONCEPT.md` §0 の小見出し「ミッション・ビジョン・バリュー」の文は、サイトに出さない。** 画面の文言にも、説明文や OGP にも使わない。作る側の拠り所で、来た人に向けた言葉ではないため。サイトの目的を書くときは、`guidelines/docs/CONCEPT.md` §1「サイトの立ち位置」に沿って書く。

## 組み方の例

```jsx
const { Card, StatTile, FieldValue } = window.RurinoNemo;

<div className="container" style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
  <StatTile label="定刻" value="21:00" note="配信はこの時刻から" />
  <StatTile label="登録者1万人" value={null} />
  <Card>
    <h3>今週の配信</h3>
    <p>尺: <FieldValue value={null} /></p>
  </Card>
</div>
```

## どこを読むか

- 見た目の正本は `styles.css` から読まれる `_ds_bundle.css` で、トークンもここにある
- 配色とコントラストの決まりは `guidelines/docs/DESIGN.md` の §4
