import type { Meta, StoryObj } from "@storybook/react-vite";

import StatGrid from "../src/components/StatGrid.tsx";
import StatTile from "../src/components/StatTile.tsx";
import { pad } from "./shared/layout.ts";

// args は必須の props の型を満たすためだけに置く。どの story も render で描くので、画面には効かない（Controls も出さない。.storybook/main.ts）。
const meta = {
  title: "General/StatTile",
  component: StatTile,
  args: { label: "定刻", value: "21:00" },
} satisfies Meta<typeof StatTile>;
export default meta;
type Story = StoryObj<typeof meta>;

// 数字を大きく見せる白いタイル。StatGrid の中に並べ、青い地に直に置く。
// 値は docs/FACTS.md のもの。値が無いタイルも同じ形で置ける（value={null} で「未確認」）。
export const ValueAndUnknown: Story = {
  render: () => (
    <div className="on-ground" style={{ padding: pad, maxWidth: "40rem" }}>
      <StatGrid>
        <StatTile label="最長の耐久" value="7:15:25" note="セミのモノマネ耐久" />
        <StatTile label="登録者1万人" value={null} />
      </StatGrid>
    </div>
  ),
};
