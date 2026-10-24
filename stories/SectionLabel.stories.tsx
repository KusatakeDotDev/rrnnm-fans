import type { Meta, StoryObj } from "@storybook/react-vite";

import EntryItem from "../src/components/EntryItem.tsx";
import EntryList from "../src/components/EntryList.tsx";
import SectionLabel from "../src/components/SectionLabel.tsx";
import { column } from "./shared/layout.ts";

const meta = { title: "General/SectionLabel", component: SectionLabel } satisfies Meta<
  typeof SectionLabel
>;
export default meta;
type Story = StoryObj<typeof meta>;

// 一覧の上に置く小見出し。白い面の中でだけ使う。h2 には使わない（h2 は StickerHeading）。
// 企画名は docs/FACTS.md §6 のもの。
export const AboveList: Story = {
  render: () => (
    <div className="on-paper" style={column}>
      <SectionLabel>はじめての人は、まずこの3本</SectionLabel>
      <EntryList>
        <EntryItem abbr="耐" category="耐久" tone="violet" title="セミのモノマネ耐久" href="#a" />
        <EntryItem abbr="朗" category="朗読" tone="blue" title="民法読み上げASMR" href="#b" />
        <EntryItem
          abbr="記"
          category="記念"
          tone="pink"
          title="8万人記念！知識0で尺八吹く"
          href="#c"
        />
      </EntryList>
    </div>
  ),
};

export const Levels: Story = {
  render: () => (
    <div className="on-paper" style={column}>
      <SectionLabel>h3（既定）— 配信のきまり</SectionLabel>
      <SectionLabel as="h4">h4 — 定刻と長さ</SectionLabel>
      <SectionLabel as="p">p — 見出しにしないラベル</SectionLabel>
    </div>
  ),
};
