import type { Meta, StoryObj } from "@storybook/react-vite";

import StatGrid from "../src/components/StatGrid.tsx";
import StatTile from "../src/components/StatTile.tsx";
import { pad } from "./shared/layout.ts";

const meta = { title: "General/StatGrid", component: StatGrid } satisfies Meta<typeof StatGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

// 青い地に直に置く。値が無いタイルは value={null} で「未確認」になる。
// 値は docs/FACTS.md のもの。分からない値は作らず null にする。
export const Schedule: Story = {
  render: () => (
    <div className="on-ground" style={{ padding: pad, maxWidth: "40rem" }}>
      <StatGrid>
        <StatTile label="定刻" value="21:00" note="配信はこの時刻から" />
        <StatTile label="配信ログ" value={null} note="年月で絞り込む" />
      </StatGrid>
    </div>
  ),
};

export const FourTiles: Story = {
  render: () => (
    <div className="on-ground" style={{ padding: pad, maxWidth: "48rem" }}>
      <StatGrid>
        <StatTile label="最長の耐久" value="7:15:25" note="セミのモノマネ耐久" />
        <StatTile label="記念配信" value="2026.09.05" note="8万人記念" />
        <StatTile label="定刻" value="21:00" note="配信はこの時刻から" />
        <StatTile label="登録者1万人" value={null} />
      </StatGrid>
    </div>
  ),
};
