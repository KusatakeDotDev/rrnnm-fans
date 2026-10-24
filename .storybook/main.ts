import { fileURLToPath } from 'node:url';

import type { StorybookConfig } from '@storybook/react-vite';

import { cssTarget } from '../src/styles/browser-targets.mjs';

// コンポーネントの一覧（Issue rurino-nemo-fansite#96）。サイトのビルドとは別に、src/components の .tsx を React のまま描く。
// Astro の設定は読まない。ルートの vite.config.ts は読み込まれるが、Vite+ の lint と整形の設定だけなので、Vite の設定はここで足す。
// .storybook/ はドットのディレクトリで tsconfig.json の `**/*` に入らないので、include に名指しで足して型検査に入れている。
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  // a11y: story ごとに axe を回す。テストとしては pnpm test:storybook で回す（vitest.storybook.config.ts）。
  // docs: デザイントークンのページ（stories/Tokens.mdx）を描く。
  // addon-vitest はここに入れない。入れると一覧にテストを回す欄が出るが、その欄は決まった名前の設定
  // （vitest.config.* など）からしか storybookTest を探さず、vitest.storybook.config.ts を見つけられない。
  // テストのほうは vitest.storybook.config.ts が storybookTest を直接読むので、ここに無くても回る。
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  // story は src/components に置かない。あそこの .tsx は全部がコンポーネントとして数えられ、
  // 同期への登録と <Name>Props を求められる（tests/repo/design-sync.test.ts）。
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.tsx'],
  core: { disableTelemetry: true },
  // Controls（args を変えて描き直す欄）は出さない。story は見本を render で描いて args を使わないので、
  // 欄で値を変えても画面が変わらず、壊れているように見える。
  features: { controls: false },
  viteFinal: (viteConfig) => {
    const aliases = viteConfig.resolve?.alias ?? [];
    return {
      ...viteConfig,
      // public/ を Vite の公開ディレクトリにしない。下の @site-assets の差し替えは public/ の .svg を import する。
      // 公開ディレクトリのままだと、開発のサーバー（storybook dev・pnpm test:storybook）が import のたびに
      // 「Assets in public directory cannot be imported from JavaScript」と警告し、ビルドには public/ が丸ごと写る。
      // story は public/ の中をパスで読まない。
      publicDir: false,
      resolve: {
        ...viteConfig.resolve,
        // tsconfig.json の paths を効かせる。vitest.config.ts と同じ。
        tsconfigPaths: true,
        // ロゴと外部サービスのアイコンだけは、同期と同じ差し替え（.design-sync/site-assets.ts）で読む。
        // この Storybook は同期のスクリーンショット比較の正解（.design-sync/sb-reference）になるので、画像も同期のバンドルと同じ
        // data URL にそろえる。サイトの版（/logo/… のパス）だと、スクリーンショット比較のサーバーが .svg を画像として返さず、
        // 正解の側だけ画像が欠ける。行き先は .design-sync/tsconfig.sync.json の paths と同じ。
        // alias は tsconfigPaths より先に効くので、@site-assets だけがこちらに替わり、ほかのエイリアスは tsconfig.json のまま。
        // 渡されたエイリアスは後ろに残す（今は空。置き換えると、Storybook や addon が後で入れたエイリアスが黙って消える）。
        alias: [
          { find: '@site-assets', replacement: fileURLToPath(new URL('../.design-sync/site-assets.ts', import.meta.url)) },
          ...(Array.isArray(aliases) ? aliases : Object.entries(aliases).map(([find, replacement]) => ({ find, replacement }))),
        ],
      },
      build: {
        ...viteConfig.build,
        // .svg を data URL にする（同期の変換の esbuild と同じ）。build の設定だが、開発のサーバー
        // （storybook dev・pnpm test:storybook）でも同じく data URL になる。
        assetsInlineLimit: (file) => (file.endsWith('.svg') ? true : undefined),
        // ADR-0025「ブラウザの下限は1か所に書き、サイトと Storybook に同じ値を渡す」。
        cssTarget,
      },
    };
  },
};

export default config;
