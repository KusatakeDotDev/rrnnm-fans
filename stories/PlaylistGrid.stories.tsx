import type { Meta, StoryObj } from '@storybook/react-vite';

import PlaylistGrid from '../src/components/PlaylistGrid.tsx';
import StickerHeading from '../src/components/StickerHeading.tsx';
import { pad } from './shared/layout.ts';

const meta = { title: 'General/PlaylistGrid', component: PlaylistGrid } satisfies Meta<typeof PlaylistGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

// 青い地に直に置く。見出しは heading で受け、格子の上に置く。
// ここに載るのは .tsx だけなので、ラッパー（PlaylistGrid.astro）のスクリプトは動かず、
// 手書きの名前と花のタイルで描かれる。
export const WithHeading: Story = {
  render: () => (
    <div className="on-ground" style={{ padding: pad }}>
      <PlaylistGrid
        heading={
          <StickerHeading tone="lavender" tilt={2}>
            再生リスト
          </StickerHeading>
        }
      />
    </div>
  ),
};

// 狭い所に置くと、画面の幅ではなく置かれた幅（37rem 以下）で2列にし、余白を詰める（root がコンテナ）。
export const InNarrowPlace: Story = {
  render: () => (
    <div className="on-ground" style={{ padding: pad, maxWidth: '30rem' }}>
      <PlaylistGrid />
    </div>
  ),
};
