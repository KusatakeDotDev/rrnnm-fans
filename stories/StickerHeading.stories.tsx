import type { Meta, StoryObj } from '@storybook/react-vite';

import StickerHeading from '../src/components/StickerHeading.tsx';

const meta = { title: 'General/StickerHeading', component: StickerHeading } satisfies Meta<typeof StickerHeading>;
export default meta;
type Story = StoryObj<typeof meta>;

// 節の見出し（h2）。青い地に直に置く。tone は pink / lavender、tilt は傾きの度数。
export const Tones: Story = {
  render: () => (
    <div className="on-ground" style={{ display: 'grid', gap: '2rem', justifyItems: 'start', padding: '2rem' }}>
      <StickerHeading tone="pink" tilt={-4}>
        今週の配信予定
      </StickerHeading>
      <StickerHeading tone="lavender" tilt={2}>
        再生リスト
      </StickerHeading>
    </div>
  ),
};
