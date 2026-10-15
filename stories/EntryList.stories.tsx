import type { Meta, StoryObj } from '@storybook/react-vite';

import EntryItem from '../src/components/EntryItem.tsx';
import EntryList from '../src/components/EntryList.tsx';
import { column } from './shared/layout.ts';

const meta = { title: 'General/EntryList', component: EntryList } satisfies Meta<typeof EntryList>;
export default meta;
type Story = StoryObj<typeof meta>;

// 企画名と記録は docs/FACTS.md §6 のもの。
// TODO(RRNNM-15): tone と分類の対応を決めたら、ここの tone と分類も合わせる。
export const ProjectList: Story = {
  render: () => (
    <div className="on-paper" style={column}>
      <EntryList>
        <EntryItem abbr="耐" category="耐久" tone="violet" title="セミのモノマネ耐久" value="7:15:25" valueField="尺" />
        <EntryItem abbr="朗" category="朗読" tone="blue" title="民法読み上げASMR" value={null} valueField="尺" />
        <EntryItem abbr="記" category="記念" tone="pink" title="8万人記念！知識0で尺八吹く" value="2026.09.05" />
      </EntryList>
    </div>
  ),
};

// 値の欄を持たない行（value を省略）と、タイトルがリンクになる行。
export const LinksWithoutValues: Story = {
  render: () => (
    <div className="on-paper" style={column}>
      <EntryList>
        <EntryItem abbr="な" category="なりきり" tone="ink" title="5重人格配信" href="#persona" />
        <EntryItem abbr="な" category="なりきり" tone="ink" title="神対応／塩対応 切り替え" href="#switch" />
        <EntryItem abbr="雑" category="雑談" tone="pale" title="ことわざを一文字変えよう" href="#kotowaza" />
      </EntryList>
    </div>
  ),
};
