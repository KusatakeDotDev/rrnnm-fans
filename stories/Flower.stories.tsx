import type { Meta, StoryObj } from '@storybook/react-vite';

import Flower from '../src/components/Flower.tsx';
import { row } from './shared/layout.ts';

const meta = { title: 'General/Flower', component: Flower } satisfies Meta<typeof Flower>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Sizes: Story = {
  render: () => (
    <div className="on-ground" style={row}>
      <Flower size="2.5rem" />
      <Flower size="1.75rem" />
      <Flower size="1.25rem" />
    </div>
  ),
};

// 色は currentColor。親（または style）の color で塗る。
export const Colored: Story = {
  render: () => (
    <div className="on-paper" style={row}>
      <Flower size="2.5rem" style={{ color: 'var(--color-fill-blue)' }} />
      <Flower size="2.5rem" style={{ color: 'var(--color-accent)' }} />
      <Flower size="2.5rem" style={{ color: 'var(--color-fill-pink)' }} />
    </div>
  ),
};
