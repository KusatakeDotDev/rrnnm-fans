import type { Meta, StoryObj } from '@storybook/react-vite';

import FieldValue from '../src/components/FieldValue.tsx';
import { pad } from './shared/layout.ts';

const meta = { title: 'General/FieldValue', component: FieldValue } satisfies Meta<typeof FieldValue>;
export default meta;
type Story = StoryObj<typeof meta>;

// 値が1つ入る場所。値があれば等幅で、無ければ（null）「未確認」チップを出す。白い面の中で使う。
// 値は docs/FACTS.md §6 のもの。
export const ValueAndUnknown: Story = {
  render: () => (
    <div
      className="on-paper"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem 1.5rem', padding: pad }}
    >
      <FieldValue value="7:15:25" />
      <FieldValue value="2026.09.05" />
      <FieldValue value={null} field="尺" />
    </div>
  ),
};
