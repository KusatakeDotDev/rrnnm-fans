import type { Meta, StoryObj } from '@storybook/react-vite';
import SkebWorks from '../src/unreleased/_parts/SkebWorks.tsx';
import { SKEB_WORKS } from '../src/data/skeb';

// Existing stories render their own examples; args only satisfy required props.
const meta = {
  title: 'General/SkebWorks', component: SkebWorks,
  args: { works: [], data: { version: 2, works: [] } },
} satisfies Meta<typeof SkebWorks>;
export default meta;
type Story = StoryObj<typeof meta>;

// ここに載るのは .tsx だけなので、ラッパー（SkebWorks.astro）のスクリプトは動かず、
// ピックアップ・並べ替え・絞り込みは隠れたまま（JS が無いときの姿）で描かれる。
const works = [SKEB_WORKS[0], SKEB_WORKS[8], SKEB_WORKS[1]];
export const SyntheticSummaryAndFallback: Story = {
  render: () => <div style={{ display: 'grid', gap: '2rem', maxWidth: '60rem', padding: 16 }}><SkebWorks works={works} data={{
    version: 2, works: [
      { url: works[0].url, inputHash: 'a'.repeat(64), status: 'approved', summary: {
        heading: '合成データの見出し', quote: { text: 'これは表示確認用の架空のセリフです。', url: works[0].url, retrieved: '2026-10-13', provenance: 'user-provided' }, tags: ['合成タグ', '表示確認'],
      } },
      { url: works[1].url, inputHash: 'b'.repeat(64), status: 'approved', summary: {
        heading: '一部の音声を紹介する合成データ', quote: { text: '作品から確かめた体の、架空のセリフです。', url: works[1].url, retrieved: '2026-10-13' }, tags: ['合成タグ'],
      } },
      { url: works[2].url, inputHash: null, status: 'missing' },
    ],
  }} /></div>,
};
