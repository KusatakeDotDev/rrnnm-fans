import type { Preview } from '@storybook/react-vite';

import { AXE_TAGS, THIRD_PARTY_EMBED } from '../tests/helpers/axe';

// サイトでは Base.astro が読むもののうち3枚。同期のエントリポイント（.design-sync/entry.ts）と同じものを読む。
// レイヤーの順の宣言（layers.css）は、ほかの CSS より先に読ませるので最初に置く。
// fonts.css（webfont）は同期に載せないので、ここでも読まない。読むと同期の見本と見た目がずれる。
import '../src/styles/layers.css';
import '../src/styles/tokens.css';
import '../src/styles/global.css';

const preview: Preview = {
  parameters: {
    // 地は global.css の body（青い地）。余白は各 story のラッパーが持つ（同期の見本と同じ）。
    layout: 'fullscreen',
    // コンポーネントの検査（pnpm test:storybook）。範囲と除外は tests/conformance/routes.spec.ts と同じ値を tests/helpers/axe.ts から読む。
    // axe は描かれた地の色で判定するので、story はコンポーネントを実際に置く地（.on-ground・.on-paper）に包んで描く。
    a11y: {
      test: 'error',
      options: { runOnly: { type: 'tag', values: AXE_TAGS } },
      // 第三者の埋め込みの中は直せないので見ない（tests/helpers/axe.ts の注記）。
      // 今はどの story にも当たらないが、ページと同じ規約を見るように置いておく。
      context: { exclude: [THIRD_PARTY_EMBED] },
    },
  },
};

export default preview;
