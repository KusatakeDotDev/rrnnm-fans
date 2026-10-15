import type { Meta, StoryObj } from '@storybook/react-vite';

import Card from '../src/components/Card.tsx';
import { column } from './shared/layout.ts';

const meta = { title: 'General/Card', component: Card } satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

// 白いステッカーのカード。青い地に直に置く。
// .on-paper を必ず付けるので、中のリンク色と見出し色が白地用に切り替わる。
export const OnGround: Story = {
  render: () => (
    <div className="on-ground" style={column}>
      <Card>
        <h3>カードの中</h3>
        <p>
          地が白に変わるので、リンクは<a href="#card">濃青ではなく青</a>になる。
        </p>
      </Card>
    </div>
  ),
};
