import type { Meta, StoryObj } from "@storybook/react-vite";

import EntryItem from "../src/components/EntryItem.tsx";
import EntryList from "../src/components/EntryList.tsx";
import { column } from "./shared/layout.ts";

// args は必須の props の型を満たすためだけに置く。どの story も render で描くので、画面には効かない（Controls も出さない。.storybook/main.ts）。
const meta = {
  title: "General/EntryItem",
  component: EntryItem,
  args: { title: "セミのモノマネ耐久" },
} satisfies Meta<typeof EntryItem>;
export default meta;
type Story = StoryObj<typeof meta>;

// EntryItem は EntryList の中に並べる。value の3つの状態: 値あり / null（未確認） / 省略（欄が無い）。
// 企画名と記録は docs/FACTS.md §6 のもの。
// TODO(RRNNM-15): tone と分類の対応を決めたら、ここの tone と分類も合わせる。
export const ValueStates: Story = {
  render: () => (
    <div className="on-paper" style={column}>
      <EntryList>
        <EntryItem
          abbr="耐"
          category="耐久"
          tone="violet"
          title="セミのモノマネ耐久"
          value="7:15:25"
          valueField="尺"
        />
        <EntryItem
          abbr="朗"
          category="朗読"
          tone="blue"
          title="民法読み上げASMR"
          value={null}
          valueField="尺"
        />
        <EntryItem abbr="安" category="安価" tone="blue-deep" title="安価形式の配信各種" />
      </EntryList>
    </div>
  ),
};

// バッジ無し（abbr と category を渡さない）の行。
export const WithoutBadge: Story = {
  render: () => (
    <div className="on-paper" style={column}>
      <EntryList>
        <EntryItem title="企画アーカイブ" href="#archive" />
        <EntryItem title="配信ログ" href="#log" value="2026.09.05" />
      </EntryList>
    </div>
  ),
};
