import type { Meta, StoryObj } from "@storybook/react-vite";

import Card from "../src/components/Card.tsx";
import StickerHeading from "../src/components/StickerHeading.tsx";
import { column } from "./shared/layout.ts";

const meta = { title: "General/Card", component: Card } satisfies Meta<typeof Card>;
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

// 上の縁に見出しのステッカーを重ねる形（トップの配信予定）。重なる分だけ、カードが上の余白を広く取る。
export const HeadingOverlap: Story = {
  render: () => (
    <div className="on-ground" style={{ ...column, paddingTop: "3rem" }}>
      <div style={{ position: "relative" }}>
        <StickerHeading
          tilt={-4}
          style={{ position: "absolute", zIndex: 1, top: "-1.875rem", left: "-1.125rem" }}
        >
          今週の配信予定
        </StickerHeading>
        <Card headingOverlap>
          <p>見出しの下から中身が始まる。</p>
        </Card>
      </div>
    </div>
  ),
};
