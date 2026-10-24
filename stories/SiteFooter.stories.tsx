import type { Meta, StoryObj } from "@storybook/react-vite";

import SiteFooter from "../src/components/SiteFooter.tsx";
import { PAGE_LINKS } from "../src/data/site-navigation";

const meta = { title: "General/SiteFooter", component: SiteFooter } satisfies Meta<
  typeof SiteFooter
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithUnreleased: Story = { args: { pageLinks: PAGE_LINKS } };

// 全ページ共通のフッター。1ページに1つ。公式アカウントのアイコンはこの中にだけ置く。
// 上の余白はフッター自身が持つ（margin-top）。
export const Default: Story = {
  render: () => (
    <div className="on-ground">
      <SiteFooter />
    </div>
  ),
};
