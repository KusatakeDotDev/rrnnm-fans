<h1 align="center">
  <a href="https://rrnnm.fans/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="public/logo/rrnnm-fans-logo-white-outlined.svg">
      <img src="public/logo/rrnnm-fans-logo-outlined.svg" alt="rrnnm.fans（非公式）" width="440">
    </picture>
  </a>
</h1>

<p align="center"><a href="https://rrnnm.fans/">https://rrnnm.fans/</a></p>

「rrnnm.fans 瑠璃野ねも 非公式ファンサイト」のソースコードです。

> 瑠璃野ねもさんを応援する非公式サイトです。ご本人・関係者とは一切関係がありません。

瑠璃野ねもさんを知るきっかけや、ご本人の活動への橋渡しになることを目指して、個人で運営しています。

## ページ

| ページ | 載せているもの |
| --- | --- |
| [トップ](https://rrnnm.fans/) | なぞると風が吹くネモフィラ畑、今週の配信予定、再生リスト |
| [推し活の資料](https://rrnnm.fans/references/) | Live2D モデル制作者のぴよ汰。さまが X で公開してくださっている、キービジュアルと三面図 |
| [このサイトについて](https://rrnnm.fans/about/) | 運営方針・クレジット・ご提案とお問い合わせの窓口 |

## 瑠璃野ねもさんの公式アカウント

- [YouTube](https://www.youtube.com/channel/UCnbNzG6tecF6BAdhuv_Tipg)
- [X](https://x.com/rurino_nemo)
- [マシュマロ](https://marshmallow-qa.com/rurino_nemo)
- [BOOTH](https://rurino-nemo.booth.pm)

## ご意見・お問い合わせ

| 内容 | 窓口 |
| --- | --- |
| 表示の崩れ・リンク切れなど、サイトの不具合 | このリポジトリの [Issues](../../issues/new/choose) |
| 「こんなページがほしい」「ここが見づらい」などのご提案 | [提案の窓口（rrnnm-fans-ideas）](https://github.com/KusatakeDotDev/rrnnm-fans-ideas) |
| 掲載内容の削除・訂正のご依頼 | 「[このサイトについて](https://rrnnm.fans/about/#contact)」のお問い合わせ先 |

Issues と提案の窓口への投稿は、誰でも見られます。削除・訂正のご依頼は、お問い合わせ先へお願いします。

Pull Request は、今のところお受けしていません。

## 技術

- [Astro](https://astro.build/) で静的なページを書き出し、[Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/)（Static Assets）で配信しています
- コンポーネントは React（`.tsx`）で書いていますが、使うのはビルドのときだけで、ブラウザには React を配っていません
- トップのネモフィラ畑は、ライブラリを使わずに WebGL2 で描いています
- テストは Vitest・Playwright・Storybook で、ミューテーションテストに Stryker を使っています

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
| `pnpm build` | `dist/` に書き出す |
| `pnpm typecheck` | 型チェック |
| `pnpm test` | ユニットテスト（Vitest） |
| `pnpm test:e2e` | E2E テスト（Playwright）。先に `pnpm build` しておく |
| `pnpm storybook` | コンポーネントの一覧（Storybook）を立てる（http://localhost:6006/） |

`src/unreleased/` には、まだ公開していないページを置いています。`pnpm dev` では表示され、`pnpm build` では書き出しません（書き出すときは `SHOW_UNRELEASED=1` を付けます）。

## ライセンス・クレジット

このリポジトリのうち運営者が作ったもの（コードを含む）は All rights reserved です。利用・複製・改変・再配布は許諾しておらず、GitHub の利用規約が認める範囲（GitHub 上で見ることと fork すること）に限って使えます。Pull Request を送っていただいたときの扱いも [`LICENSE`](LICENSE) にあります。

作品からの引用や作品名、各サービスのロゴやフォントなど、ほかの人の著作物は、それぞれの権利者のものです。ロゴとフォントのファイルと条件は [`LICENSE`](LICENSE) の末尾にあります。

トップのネモフィラ畑の花には、トキワ雑貨店さんの [「ネモフィラ」【3Dモデル】](https://booth.pm/ja/items/3991171) を使わせていただいています。
