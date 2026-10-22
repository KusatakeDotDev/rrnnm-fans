import type { Meta, StoryObj } from '@storybook/react-vite';

import Butterfly from '../src/components/Butterfly.tsx';
import { row } from './shared/layout.ts';

const meta = { title: 'General/Butterfly', component: Butterfly } satisfies Meta<typeof Butterfly>;
export default meta;
type Story = StoryObj<typeof meta>;

// 大きさは size（幅）で決める。色は tone を渡さなければ currentColor なので、親の color で塗る。
export const Sizes: Story = {
  render: () => (
    <div className="on-ground" style={row}>
      <Butterfly size="2.5rem" />
      <Butterfly size="1.75rem" />
      <Butterfly size="1.25rem" />
    </div>
  ),
};

export const Tones: Story = {
  render: () => (
    <div className="on-paper" style={row}>
      <Butterfly size="2.5rem" tone="pink" />
      <Butterfly size="2.5rem" tone="violet" />
    </div>
  ),
};

export const Colored: Story = {
  render: () => (
    <div className="on-paper" style={row}>
      <Butterfly size="2.5rem" style={{ color: 'var(--color-accent)' }} />
      <Butterfly size="2.5rem" style={{ color: 'var(--color-fill-pink)' }} />
      <Butterfly size="2.5rem" style={{ color: 'var(--color-fill-blue)' }} />
    </div>
  ),
};
