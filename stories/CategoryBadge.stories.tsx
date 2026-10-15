import type { Meta, StoryObj } from '@storybook/react-vite';

import CategoryBadge from '../src/components/CategoryBadge.tsx';
import { pad } from './shared/layout.ts';

// args は必須の props の型を満たすためだけに置く。どの story も render で描くので、画面には効かない（Controls も出さない。.storybook/main.ts）。
const meta = {
  title: 'General/CategoryBadge',
  component: CategoryBadge,
  args: { abbr: '例', label: '仮の分類（violet）', tone: 'violet' },
} satisfies Meta<typeof CategoryBadge>;
export default meta;
type Story = StoryObj<typeof meta>;

// TODO(RRNNM-15): どの分類にどの tone を当てるかを決めたら、略号と分類名を差し替える。
// tone の見本。略号と分類名は仮のもの。文字色は tone から自動で決まる。label は読み上げ用で画面には出ない。
const tones = ['violet', 'blue', 'blue-deep', 'ink', 'pink', 'pale', 'amber'] as const;

export const AllTones: Story = {
  render: () => (
    <div className="on-paper" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem 1.5rem', padding: pad }}>
      {tones.map((tone) => (
        <span key={tone} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <CategoryBadge abbr="例" label={`仮の分類（${tone}）`} tone={tone} />
          <code style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}>{tone}</code>
        </span>
      ))}
    </div>
  ),
};
