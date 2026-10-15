import { defineConfig, devices } from '@playwright/test';

/**
 * 規約テスト（conformance）の層。→ docs/adr/0003-testing-and-ci.md
 *
 * ビルド済みの dist を wrangler dev で配って、実際の HTML に対して回す。
 *
 * astro preview ではなく wrangler dev を使う理由は2つ。
 *   1. Astro 7 の preview は非TTYだと自動でバックグラウンドへ回り、Playwright から
 *      「起動直後に終了した」に見える。webServer として管理できない。
 *   2. wrangler dev は本番と同じ workerd で、public/_headers も実際に適用する。
 *      つまり X-Robots-Tag と Cache-Control を「配られたレスポンス」で確かめられる（→ noindex.spec.ts・asset-cache.spec.ts）。
 * wrangler は既に devDependency なので、依存は増えない。
 */
const PORT = 4321;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * YouTube の oEmbed と画像も共通では遮断し、専用テストの page.route で成功・失敗を返す。
 * ブラウザを使う規約テストでは、X の埋め込み（src/pages/references.astro）を読ませない。
 * 読ませると、axe が回る時点で X の引用や iframe が出ているかどうかが毎回変わり、出ていれば X の中まで降りて
 * こちらで直せない違反を拾う。結果が X の描き方と通信に左右される。止めれば、どのテストも
 * 埋め込みが出なかったときの表示（ポストへのリンク）を見ることになり、これはこちらの HTML なので直せる。
 * X では、埋め込みのコードを取る oEmbed（publish.x.com）と、それを描く widgets.js（platform.x.com）を止める。
 * X の iframe はその後にしか出ないので、X の遮断にはこの2つで足りる。
 * oEmbed を差し込む動きは、tests/conformance/x-embed.spec.ts が page.route で応答を作って見る（名前を引く前に横取りする）。
 * グッズのページ（src/unreleased/goods.astro）の BOOTH の商品の画像（booth.pximg.net）も読ませない。読ませると、
 * /goods/ を開くテストが BOOTH の画像の配信の速さに左右され、遅ければ load を待つあいだにタイムアウトする。
 * 画像は alt が空で、どの規約テストも画像の中身を見ないので、止めても見落とすものは無い。止めれば、どのテストも
 * 画像の下に敷いた花のカードを見る。
 * 止め方は Chromium の起動オプション（名前を引けないことにする）。ページごとに page.route を書かずに済む。
 * use に広げると launchOptions ごと置き換わるので、ほかの起動オプションを足すときは、ここの args に足す。
 * X の遮断は tests/conformance/x-embed.spec.ts、YouTube の遮断は playlist-oembed.spec.ts、BOOTH の遮断は booth-images.spec.ts が見る。
 */
const BLOCK_EXTERNAL_EMBEDS = {
  launchOptions: { executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'], args: ['--host-resolver-rules=MAP platform.x.com ~NOTFOUND, MAP publish.x.com ~NOTFOUND, MAP www.youtube.com ~NOTFOUND, MAP i.ytimg.com ~NOTFOUND, MAP booth.pximg.net ~NOTFOUND'] },
};

/**
 * ブラウザを使うプロジェクトは、どれもこれを元にする。
 * 止めているかを見る検査は conformance でだけ回るので、プロジェクトごとに BLOCK_EXTERNAL_EMBEDS を書くと、
 * contrast の側だけ外しても誰も気付かない。
 */
const CHROME_WITH_WEBFONT = { ...devices['Desktop Chrome'], ...BLOCK_EXTERNAL_EMBEDS };

/**
 * webfont（Zen Maru Gothic）も読ませない。ページの字が当たるチャンクをページを開くたびに数十本読み、
 * E2E 全体が倍ほど遅くなったため（docs/adr/0024-zen-maru-gothic-webfont.md）。読めない面はフォールバック
 * （src/styles/font-fallback.css。縦のメトリクスは webfont と同じ）で描くので、行の高さは変わらない。
 * webfont が読まれることは webfont.spec.ts が、止めないプロジェクトで見る。
 */
const CHROME = {
  ...CHROME_WITH_WEBFONT,
  launchOptions: { ...BLOCK_EXTERNAL_EMBEDS.launchOptions, args: [...BLOCK_EXTERNAL_EMBEDS.launchOptions.args, '--disable-remote-fonts'] },
};

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm exec wrangler dev --port ${PORT} --ip 127.0.0.1 --assets ${process.env['TEST_DIST'] ?? 'dist'}`,
    url: BASE_URL,
    reuseExistingServer: false,
    // workerd の起動は速くない。CI の遅いランナーでも足りる幅を取る。
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
  projects: [
    {
      // ビルド成果物そのものへの検査。ブラウザを使わない。
      name: 'artifact',
      testDir: 'tests/artifact',
    },
    {
      // 色に依存しない規約。1回だけ回す。
      name: 'conformance',
      testDir: 'tests/conformance',
      testIgnore: [/contrast\.spec\.ts/, /webfont\.spec\.ts/],
      use: CHROME,
    },
    {
      // webfont を止めずに、読まれることだけを見る。
      name: 'webfont',
      testDir: 'tests/conformance',
      testMatch: /webfont\.spec\.ts/,
      use: CHROME_WITH_WEBFONT,
    },
    {
      // docs/DESIGN.md §6「ライト／ダーク両テーマで AA」。
      // プロジェクトを分けると、落ちたテーマがレポートの行名に出る。
      name: 'contrast-light',
      testDir: 'tests/conformance',
      testMatch: /contrast\.spec\.ts/,
      use: { ...CHROME, colorScheme: 'light' },
    },
    {
      // TODO(RRNNM-28): ダークモードが入ったら消す（contrast.spec.ts の fixme と一緒に）。
      name: 'contrast-dark',
      testDir: 'tests/conformance',
      testMatch: /contrast\.spec\.ts/,
      use: { ...CHROME, colorScheme: 'dark' },
    },
  ],
});
