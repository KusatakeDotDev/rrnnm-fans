# /design-sync のメモ

## このリポジトリの形

- **同期の形は storybook（2026-10-04 に package から切り替えた。Issue rurino-nemo-fansite#96）。** 見本は `stories/*.stories.tsx` から作られ（`.design-sync/.cache/previews/` に生成）、参照は `pnpm exec storybook build -c .storybook -o .design-sync/sb-reference` で作る Storybook のビルド。story を直したら参照も作り直す
- **パッケージではなく Astro のサイト。** `dist/` のパッケージのビルドは無い。エントリポイントは `.design-sync/entry.ts`（コンポーネントは default export なので、ここで名前を付けて書き出す）。変換には `--entry ./.design-sync/entry.ts` を渡す
- **`extraEntries` にも `./.design-sync/entry.ts` を書く。** storybook の形は、コンポーネントの名前（書き出しの一覧）を `package.json` の `types` の `.d.ts` から読む。このリポジトリには `types` が無いので一覧が空になり、story の題名が全部 `[TITLE_UNMAPPED]` で落ちてコンポーネントが0件になった。`extraEntries` にエントリポイントを渡すと、そこから名前を読む
- **型は `buildCmd`（`tsc -p .design-sync/tsconfig.types.json`）で `types/` に書き出す**（gitignore 済み）。変換はリポジトリ直下の `types/` を型のルートとして読む。変換の前に必ず回す
- **props の型の名前は `<Name>Props` にする。** 変換は `<Name>Props` の名前で探す。コンポーネントの中の `interface Props` のままだと、props が `[key: string]: unknown` になる
- **`tokens.css` と `global.css` は `entry.ts` から import してバンドルに入れる。** `cssEntry` は1枚しか取れず、`tokensGlob` はトークンのパッケージ（node_modules）が前提なので、どちらも使わない
- CSS Modules は esbuild の local-css で `_ds_bundle.css` に入る。クラス名は `StatTile_tile` の形で、Vite のハッシュとは別物。見た目は同じ
- 型の変換は `strict: false` なので、`string | null` が `string` と出る（`value?: string`）。`null` を渡す使い方は `conventions.md` の例で補う

## 書体

- **`[FONT_MISSING]` はわざと出したまま。** 同期先では、`--font-sans` の Zen Maru Gothic とそのフォールバックが無く、後ろに並べた端末の書体（Yu Gothic UI・Hiragino Sans など）で描く。Quicksand も端末にあれば使う名前で、同期先でも同じ振る舞いになる
- **Zen Maru Gothic の webfont（`src/styles/fonts.css`）は同期に載せていない。** `unicode-range` で分けたチャンクが3ウェイトで 366 本・約 5.9 MiB あり、見本のために全部を付けるには重い

## 知っている警告

- `[FONT_MISSING]`: 上の「書体」のとおり
- `[DTS_STYLE_SYSTEM]` @types/react: React の style の props を落としたという知らせ。コンポーネントの props には関係しない

## 見本（story）

- **見本は `stories/*.stories.tsx` から作る**（2026-10-04 から。それまでは `.design-sync/previews/` に手で書いていた）。変換が story のモジュールを丸ごとバンドルに向けてコンパイルし、`.design-sync/.cache/previews/` に置く（gitignore 済み）。`.design-sync/previews/` に置いたファイルは生成物より優先されるので、置くのは story では表せないときだけ
- **story の題名は `General/<コンポーネント名>` にする。** 同期先の分類は題名の1つ前の段から作られ、英数字以外は落ちる（当時の題名 `部品/…` では `misc` になった）。`General` にすると同期先の場所が前と同じ `components/general/` になる
- **地を敷いて置く。** story はコンポーネントを `.on-ground`（青い地）か `.on-paper`（白い面）で包む。プレビューの body は白で、Storybook の body は `global.css` の青い地とドット。スクリーンショット比較では、Storybook の側だけラッパーの外にドットの地が写る。これは枠の違いで、採点では無視する
- **Storybook も画像は同期の差し替え（`.design-sync/site-assets.ts`）で読む**（`.storybook/main.ts` の `alias` と `assetsInlineLimit`。ビルドでも storybook dev・`pnpm test:storybook` でも data URL になる）。サイトの版（`/logo/…` のパス）にすると、スクリーンショット比較のサーバーが `.svg` を `application/octet-stream` で返し、Storybook の側だけ画像が欠ける
- **畑の state はページ全体に効く。** overlay のヘッダーのロゴ（live で白抜き）は、`body:has([data-field][data-state='live'])` で切り替わる。カードの見本は全部が1つの document に並ぶので、NemophilaField は `config.json` の `overrides` で `cardMode: "single"`（`primaryStory: "Day"`）にして、1つの document に畑を1つだけ描く
- **story に、読み込まれない `loading="lazy"` の画像を置かない。** スクリーンショット比較は撮る前に全部の画像の `decode()` を待つが、読み込まれない画像の `decode()` はいつまでも終わらない。lazy の画像が読み込まれないのは、隠れている（`display:none`）とき、または画面からずっと下にあるとき（900x700 の Chromium で確かめた。画面の上から 2,500px 下までは読み込まれ、4,000px 下では読み込まれなかった。2026-10-05）
  - SiteHeader の白いロゴ（live の畑の上でだけ出る）は、これでスクリーンショット比較を NemophilaField で止め、そのあと `Page crashed` で落とした（2026-10-04）。それで `loading="lazy"` を外した。前の形（package）の撮影で Chromium が落ちていたのも、たぶん同じ原因
  - SiteFooter のロゴは lazy のまま。見えていて、story では画面の中に出るので読み込まれる。フッターの上に高い中身を積む story（ページを丸ごと組むなど）を作るときは、この決まりに当たらないか見る
- **PlaylistGrid は撮影の大きさを `900x1100` にしている**（`overrides.PlaylistGrid.viewport`）。既定の 900x700 だと、プレビューの側だけ下の段が切れる
- **見本の値は作らない。** 企画名・記録・件数は `docs/FACTS.md` にあるものだけを使う（§6 の代表企画など）。分からない値は `null`（未確認）にする。Claude Design は見本を実際の例として読むので、作った値が生成されたデザインに本物の情報として出てしまう
- **ScheduleCard の画像は、見本用の SVG（data URL）。** 本物の YouTube のサムネイルを直に置けるのは、ADR-0004（スケジュール動画1本）と ADR-0008（再生リスト）の例外だけなので、見本では使わない。タイトルも「（見本）」と付けた仮のもの
- **tone と分類の対応はまだ決まっていない**（`src/components/tones.ts`、RRNNM-15）。CategoryBadge の見本は略号を「例」、分類名を「仮の分類（tone）」にしている。決まったら story も直す
- **Quote には、出典に実際にある文（「ネモフィラの花から生まれた妖精🌸」）だけを引く。** 見本のために文を作って公式の概要欄の引用に見せない

## 載せていないもの・型の書き方

- **トークンのページ（`stories/Tokens.mdx`）は載せていない。** docs の項目なので、同期は読まない
- **props の型の中身は、名前の付いた型に分けずコンポーネントの props に書く。** 変換は名前の付いた型を展開せず、名前だけを渡す（前は ScheduleCard の `schedule` が `ScheduleData` とだけ出て、Claude Design から中身が読めなかった）。ScheduleCard は `schedule` の中身を props に書き、取る側の `schedule-oembed.ts` がそこから型を作る
- ラッパーの `.astro` を持つコンポーネント（NemophilaField・PlaylistGrid・ScheduleCard）は `.tsx` の方を書き出している。ラッパーのスクリプトは同期先では動かない（畑は CSS のグラデーションで出る。ADR-0009 の WebGL2 が無いときの姿）
- **NemophilaField は default export だけを書き出す。** 前回の畑の絵を敷くスクリプトを出す名前付きの export（`NemophilaFieldWithSnapshot`）はラッパー専用で、`entry.ts` に書かない。敷くスクリプトだけが同期先に出ると、絵を外す `mountField` が無いので、敷いた絵が残り続ける。default がスクリプトを出さないことは `tests/repo/nemophila-field.test.ts` が見る
- **ロゴと外部サービスのアイコンは、エイリアス `@site-assets` で差し替えてバンドルに埋め込む。** サイトでは `src/components/site-assets.ts`（`/logo/…`・`/brand/…` のパス）、同期では `.design-sync/site-assets.ts`（`public/` の .svg を import し、esbuild が data URL にする）。行き先は `.design-sync/tsconfig.sync.json` の `paths` で、`config.json` の `tsconfig` がそれを指す
- **`tsconfig.sync.json` にコメントも `"//"` のキーも書かない。** 変換は `//` から行末までを消してから JSON として読むので、`"//"` のキーを書くと読めなくなり、黙ってエイリアスが効かなくなる（サイトの版の画像パスがバンドルに入る）

## 次の同期で気をつけること

- root の要素が条件で替わるコンポーネント（自分の props しか受け取らないコンポーネント）を足したら、`conventions.md` の props の例外に名前を足す
- **コンポーネントを足したら `entry.ts` と `config.json` の `componentSrcMap` の両方に足す。** ずれると `tests/repo/design-sync.test.ts` が落ちる
- コンポーネントを `.tsx` に移したら、**同じ PR で** props の型の名前を `<Name>Props` に揃え、同期に登録する（ADR-0011 の A・B・C もそうしている）。ラッパーの `.astro` を持つコンポーネントは `.tsx` の方を書き出す
- 載せないコンポーネントは `componentSrcMap` に `null` と書く。変換（`lib/source-kit.mjs`）は値が `null` の項目を、そのコンポーネントを除くものとして扱う
- コンポーネントが新しい画像を使うときは、`src/components/site-assets.ts` と `.design-sync/site-assets.ts` の両方に同じ名前・同じ画像で足す（`tests/repo/design-sync.test.ts` が突き合わせる）
- **`tsconfig.sync.json` の `paths` は、`extends` しても親とまとめられず丸ごと置き換わる。** ルートの `tsconfig.json` の `paths` にエイリアスを足したら、`tsconfig.sync.json` にも写す。写し忘れると、同期のバンドルだけでそのエイリアスが解決できない（型検査・単体テストでは捕まらない）
- 単体テスト（vitest）は `resolve.tsconfigPaths` でルートの `paths` を読むので、エイリアスを足しても vitest の設定を直す必要は無い
- `global.css` の `body` のルール（青い地・点の模様）は同期先の地にもなる。`global.css` を変えたら、見本の地も変わる
- `types/` が古いまま変換すると、props の型が古くなる。先に `buildCmd` を回す
- **リポジトリの `node_modules` が空だと `buildCmd`（tsc）が react を見つけられず落ちる。** 先に `pnpm i --frozen-lockfile`
- **検査の描画とスクリーンショット比較には `.ds-sync/` に playwright が要る**（`.ds-sync/` は gitignore なので毎回）。入れないと `[RENDER_SKIPPED]` で止まる。バージョンは `package.json` の `@playwright/test` に合わせて、リポジトリ直下で `npm i --prefix .ds-sync playwright@<そのバージョン>` を回す。`.ds-sync/` に入って `npm i` すると、npm がリポジトリ直下の `package.json` の `devEngines` を読んで `EBADDEVENGINES` で止まる（`npm init -y` も同じ。→ `docs/adr/0003-testing-and-ci.md` §6）
- コンポーネントを足したら、`stories/<Name>.stories.tsx` に story を書き（題名は `General/<Name>`）、参照の Storybook（`.design-sync/sb-reference`）を作り直してから同期する

## 再同期で古くなりうるもの

- story の props は手で書いている。コンポーネントの props の名前や値を変えたら story も直す（型検査と `pnpm test:storybook` で気付く）
- 参照の Storybook（`.design-sync/sb-reference`）は手で作る。story やコンポーネントを変えたのに作り直さないと、古い正解と比べることになる（`[REFERENCE_STALE?]`）
- PlaylistGrid の見本は、スクリプトが動かないときの手書きの名前（`src/data/playlists.ts`）で描かれる。そこを変えると見本の見た目も変わる
- 書体は端末まかせ（上の「書体」）なので、撮る端末で文字の形が変わる
- スクリーンショット比較の採点は、2026-10-04 に21コンポーネントとも match（地の敷き方が違うだけ）。どのコンポーネントも story は6本以下なので、撮る本数の上限（6）には掛かっていない
- スクリーンショット比較のスクリプト（`.ds-sync/storybook/compare.mjs`・`http-serve.mjs`）は、`.svg` の MIME を持たず、画像の `decode()` に時間の上限が無い。上の「見本（story）」の2つの手当て（data URL・lazy を外す）はこれへの対処。スクリプトが直ったら、Storybook の画像をサイトの版に戻せる
