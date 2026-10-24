# 開発

このリポジトリの中身と、手元で動かす手順です。

## 外からは開けない参照

設計の記録（ADR）と運用の資料は非公開のリポジトリに置き、手元では `docs/` に取ってきて読んでいます。購入した3Dモデルの素材と、それを扱うコードも非公開のリポジトリに置き、手元ではこのリポジトリに重ねています。タスクは Linear で管理しています。また、このリポジトリは、以前の非公開のリポジトリのスナップショットから始めました。そのため、コードのコメントやテストにある次の参照は、外からは開けません。

| 書き方 | 指しているもの |
| --- | --- |
| `ADR-0011`・`docs/…` | 非公開のリポジトリにある設計の記録と資料 |
| `scripts/generate-field-assets.mjs`・`src/lib/field-bundle.ts` など（`.gitignore` の「非公開の素材」の行のパス） | 非公開の素材のリポジトリから `pnpm assets:pull` で重ねるファイル |
| `RRNNM-49`・`TODO(RRNNM-49)` | Linear の Issue |
| `rurino-nemo-fansite#78` | 以前のリポジトリの Pull Request・Issue |

素の `#78` は、このリポジトリの Pull Request・Issue です。

## 手元で動かす

[pnpm](https://pnpm.io/installation) を入れておきます。使う Node.js と pnpm のバージョンは `package.json` の `devEngines` に書いてあり、pnpm が自動で取ってきます。このリポジトリの中では、npm（`npm`・`npx`）は `devEngines` に止められて動きません。

```sh
pnpm install
pnpm dev
```

| コマンド | すること |
| --- | --- |
| `pnpm dev` | 開発サーバーを立てる（http://localhost:4321/） |
| `pnpm astro dev stop` | 開発サーバーを止める（バックグラウンドに残ったときも） |
| `pnpm build` | 実データで `dist/` に書き出す。ビルドの記録 `dist.receipt.json` も書く |
| `pnpm typecheck` | 型チェック |
| `pnpm lint:css` | CSS の lint（Stylelint） |
| `pnpm test` | ユニットテストとリポジトリの検査（Vite+ の `vp test`。`tests/unit/` と `tests/repo/`） |
| `pnpm test:storybook` | コンポーネントのテスト。story を1つずつ Chromium で描き、アクセシビリティの検査（axe）を回す |
| `pnpm test:ci` | CI と同じ Playwright のテスト。`.test-dist/` に固定応答でビルドしてから回す。付けなければ、下の `on`・`off` を順に両方回す |
| `pnpm test:ci on` | 未公開のページも出すビルドに、Playwright のテストを全部掛ける |
| `pnpm test:ci off` | 未公開のページを出さないビルドに、成果物の検査だけを掛ける。ページを開かないので、ブラウザもサーバーも立てない |
| `pnpm test:e2e` | Playwright のテスト全部（`tests/artifact/`・`tests/conformance/`・`tests/e2e/`）を、`pnpm build` で作った実データの `dist/` に掛ける。本番に出す前の検査（`pnpm test:release`）が回すのと同じ形で、CI が回す `pnpm test:ci` とは別 |
| `pnpm test:mutation` | ミューテーションテスト（Stryker）。対象は `src/lib/` と `scripts/skeb-summary-core.ts` |
| `pnpm test:mutation:floors` | `pnpm test:mutation` のあとに回し、ファイルごとのミューテーションスコアを下限（既定は 95%）と比べる |
| `pnpm storybook` | コンポーネントの一覧（Storybook）を立てる（http://localhost:6006/） |

`pnpm test:ci` に `-` で始まる引数を付けると、Playwright に渡します（`pnpm test:ci on --shard=1/3` など）。値は `=` でつなぎます。空白で離すと、値がビルドの名前として読まれます。CI と本番でビルドを分けている理由は、下の「CI のビルドと、本番に配るビルド」にあります。

`pnpm docs:pull`（設計の記録と資料）と `pnpm assets:pull`（トップの畑の花の株に使う、購入した3Dモデルの素材）は、非公開のリポジトリから取ってくるので、そのリポジトリを読める人だけが使えます。素材は、購入したときの許諾が公開のリポジトリでの再配布を含まないので、非公開にしています。どちらも無くてもビルドとテストは通り、トップの畑は花の株を描かず、一枚絵の花だけで描きます。

`src/unreleased/` には、まだ公開していないページを置いています。`pnpm dev` では表示され、`pnpm build` では書き出しません（書き出すときは `SHOW_UNRELEASED=1` を付けます）。

## ディレクトリ

| 場所 | 置いているもの |
| --- | --- |
| `src/pages/` | ページ |
| `src/layouts/` | 全ページに共通のレイアウト（`Base.astro`）と OGP の画像の指定 |
| `src/components/` | UI のコンポーネント（`.tsx` と CSS Modules）。バンドルするスクリプトや、ビルドのときに取るデータが要るものは、同じ名前の `.astro` をラッパーにしています |
| `src/data/` | サイトに出すデータと、ビルドのときに外のデータ（配信予定の動画の oEmbed など）を取るモジュール |
| `src/lib/` | 純関数（DOM・fs・Astro に触らないもの）。ユニットテストとミューテーションテストの対象です |
| `src/integrations/` | 自前の Astro のインテグレーション |
| `src/unreleased/` | まだ公開していないページ |
| `src/styles/` | デザイントークン（`tokens.css`）・全体の CSS・フォント |
| `stories/` | Storybook の story |
| `tests/unit/` | ユニットテスト（Vitest） |
| `tests/repo/` | リポジトリの決まりと設定の突き合わせ、スクリプトを動かす検査（Vitest） |
| `tests/conformance/` | 全ページにかかる規約のテスト（Playwright） |
| `tests/e2e/` | ページごとの機能のテスト（Playwright） |
| `tests/artifact/` | ビルド成果物の中身の検査（Playwright。ブラウザは使いません） |
| `scripts/` | ビルド・デプロイ・非公開のリポジトリの取得などのスクリプト |
| `.design-sync/` | コンポーネントを Claude Design に同期するための設定 |
| `.github/` | CI のワークフロー・Dependabot の設定・Issue と Pull Request のテンプレート |

## CI のビルドと、本番に配るビルド

PR の CI は、外への取得を決まった応答（固定応答）に差し替えたビルドを検査し、本番には、実データでビルドして検査したものをそのまま配ります。

- **CI（`pnpm test:ci`）のビルドは、外への取得を固定応答に差し替えます。** YouTube や BOOTH の調子で、関係ない PR の CI が落ちないようにするためです。差し替えるのは、トップの配信予定のカードのための YouTube への取得（oEmbed と、高解像度のサムネイルがあるかを見る `i.ytimg.com` への HEAD）と、未公開のグッズのページのための BOOTH の商品ページへの取得です。`i.ytimg.com` から画像そのものを取ろうとすると、エラーにします
- **テスト用のビルドは、応答を決めていない外への取得と、`fetch` に `signal` を渡していない取得があると落ちます。** 結果が外のサービスの調子で変わらないように、また、タイムアウト（`AbortSignal.timeout`）の無い取得で、相手が詰まったときにビルドが止まり続けないようにするためです
- **差し替えるコード（`tests/fixtures/build-fetch.mjs`）は、テスト用のビルドのときだけ、`scripts/build.mjs` が `node --import` で Astro のビルドのプロセスに読ませ、グローバルの `fetch` を置き換えます。** サイトのコードには、テストのときだけ通る分岐を置きません。置くと、テストで確かめた経路と、本番のビルドが通る経路が分かれるためです
- **テスト用のビルドは、`dist/` ではなく `.test-dist/` に書き出します。** 固定応答で作ったものを、本番やプレビューに配らないためです。`scripts/build.mjs` は、テスト用の環境変数（`TEST_BUILD_SCENARIO`・`TEST_DIST`）が残っているとビルドしません。作ったものと検査するものが食い違わないようにするためです
- **ビルドは、書き出したディレクトリの横に記録を書きます**（`dist.receipt.json`。テスト用のビルドは `.test-dist.receipt.json`）。中身は、ビルドの種類（実データの `live` か、固定応答の `success`）、未公開のページを出したか、書き出した全部のファイルのパスと中身から取ったダイジェスト（SHA-256）です。配る前に、配るものが実データのビルドで、そのあと書き換わっていないかを確かめるためです
- **`pnpm test:release` は、`pnpm build` で作った実データの `dist/` を検査します。** トップの予定のサムネイルを YouTube から実際に取り、HTML に書いた大きさと合うかを確かめてから、`pnpm test:e2e` を回します。PR の CI では YouTube から本当に取れるかを見ないので、本番に出す前にここで見ます。通ったら、ビルドの記録と同じ中身を `dist.verified.json` に書きます
- **配るのは `scripts/deploy-dist.mjs`（`pnpm run deploy`・`pnpm run deploy:preview <名前>`）で、`dist/` をビルドし直さずにそのまま配ります。** テスト用の環境変数が残っているとき、記録が実データのビルドでないとき、記録したあとに `dist/` の中身が変わったときは、配りません。本番では、`dist.verified.json` が今の `dist/` の記録と違うときと、未公開のページを出したビルドのときも、配りません。検査したものと配るものが食い違わないようにするためです

本番には、GitHub の Release からだけ出します。そのジョブ（`.github/workflows/release.yml`）が、ミューテーションテスト、`pnpm build`、`pnpm test:release`、`pnpm run deploy` を順に回します。
