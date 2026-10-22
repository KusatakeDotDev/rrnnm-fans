import type { Meta, StoryObj } from '@storybook/react-vite';

import SiteHeader from '../src/components/SiteHeader.tsx';
import { FieldHero } from './shared/FieldHero.tsx';

const meta = { title: 'General/SiteHeader', component: SiteHeader } satisfies Meta<typeof SiteHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

// 全ページ共通のヘッダー。1ページに1つ。
export const Default: Story = {
  render: () => (
    <div className="on-ground" style={{ paddingBottom: '2rem' }}>
      <SiteHeader />
    </div>
  ),
};

// 下層ページは paper で白い帯に置く。下の見出しの帯と本文との区切りの線は、ページのレイアウト（Base.astro）が足す。
export const Paper: Story = {
  render: () => (
    <div className="on-ground" style={{ paddingBottom: '2rem' }}>
      <SiteHeader paper />
    </div>
  ),
};

// トップだけ、畑の上に overlay で重ねる。
export const OverlayOnField: Story = {
  render: () => (
    <div style={{ position: 'relative' }}>
      <SiteHeader overlay />
      <FieldHero />
    </div>
  ),
};
