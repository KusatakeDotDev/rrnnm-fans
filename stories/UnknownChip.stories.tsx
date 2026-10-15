import type { Meta, StoryObj } from '@storybook/react-vite';

import UnknownChip from '../src/components/UnknownChip.tsx';
import { pad } from './shared/layout.ts';

const meta = { title: 'General/UnknownChip', component: UnknownChip } satisfies Meta<typeof UnknownChip>;
export default meta;
type Story = StoryObj<typeof meta>;

// 「未確認」チップ。値が無いことを隠さず一級の状態として出す（docs/DESIGN.md §2 表示規約）。
// field は何が未確認かを前に付ける。白い面の中で使う。
export const Fields: Story = {
  render: () => (
    <div className="on-paper" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem', padding: pad }}>
      <UnknownChip />
      <UnknownChip field="尺" />
      <UnknownChip field="日付" />
    </div>
  ),
};
