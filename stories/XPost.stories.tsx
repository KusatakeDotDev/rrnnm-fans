import type { Meta, StoryObj } from '@storybook/react-vite';

import XPost from '../src/components/XPost.tsx';
import { column } from './shared/layout.ts';

// X のポストの埋め込みの箱。サイトではラッパー（XPost.astro）が、子のリンクを oEmbed の引用に差し替える。
// 見本は X につながず、差し替える前のリンクと、差し替えたあとの引用の形（oEmbed が返す blockquote）を置く。
// 引用の中身は形だけの文にし、実在のポストに見せない。
const meta = { title: 'General/XPost', component: XPost } satisfies Meta<typeof XPost>;
export default meta;
type Story = StoryObj<typeof meta>;

const link = (
  <p>
    <a href="#x-post">X でポストを見る（2022年1月22日の投稿）</a>
  </p>
);

const quote = (
  <blockquote className="twitter-tweet">
    <p lang="ja" dir="ltr">ここに、X が返すポストの本文が入る。</p>
    — 投稿したアカウント <a href="#x-post">2022年1月22日</a>
  </blockquote>
);

// 白い面の上（/references/）。差し替える前のリンクと、差し替えたあとの引用。
export const OnPaper: Story = {
  render: () => (
    <div className="on-paper" style={column}>
      <XPost>{link}</XPost>
      <XPost>{quote}</XPost>
    </div>
  ),
};

// 青い地の上（/kusobaka-slot/）。引用に白い面を敷く。
export const OnGround: Story = {
  render: () => (
    <div className="on-ground" style={column}>
      <XPost on="ground">{quote}</XPost>
    </div>
  ),
};
