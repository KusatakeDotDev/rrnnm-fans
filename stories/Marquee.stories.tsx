import type { Meta, StoryObj } from '@storybook/react-vite';

import Marquee from '../src/components/Marquee.tsx';
import { pad } from './shared/layout.ts';

const meta = { title: 'General/Marquee', component: Marquee } satisfies Meta<typeof Marquee>;
export default meta;
type Story = StoryObj<typeof meta>;

// トップの畑（NemophilaField）のすぐ下に置く文字の帯。流れない装飾。
// 畑に重ねるための負の margin-top（2.125rem）があるので、単体で置く見本では上を広めに空ける。
export const Default: Story = {
  render: () => (
    <div className="on-ground" style={{ paddingTop: '3.5rem', paddingBottom: pad }}>
      <Marquee />
    </div>
  ),
};
