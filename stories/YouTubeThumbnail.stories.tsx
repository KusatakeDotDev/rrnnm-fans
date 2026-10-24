import type { Meta, StoryObj } from "@storybook/react-vite";

import Flower from "../src/components/Flower.tsx";
import YouTubeThumbnail from "../src/components/YouTubeThumbnail.tsx";
import { pad } from "./shared/layout.ts";

const meta = { title: "General/YouTubeThumbnail", component: YouTubeThumbnail } satisfies Meta<
  typeof YouTubeThumbnail
>;
export default meta;
type Story = StoryObj<typeof meta>;

// YouTube へのリンクの中に置くサムネイル枠。細い線で縁取るだけで、ホバーには反応しない。
// 画像は YouTube が配るものだけを入れる。画像が来るまでは花を入れておける。
// リンクはハンドル（@…）ではなくチャンネル ID の URL にする（ハンドルは本人が変えられる）。
export const InLink: Story = {
  render: () => (
    <div className="on-paper" style={{ padding: pad, maxWidth: "24rem" }}>
      <a
        href="https://www.youtube.com/channel/UCnbNzG6tecF6BAdhuv_Tipg"
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: "block" }}
      >
        <YouTubeThumbnail>
          <Flower size="3rem" />
        </YouTubeThumbnail>
        <span className="sr-only">公式 YouTube チャンネル（外部サイトを新しいタブで開く）</span>
      </a>
    </div>
  ),
};
