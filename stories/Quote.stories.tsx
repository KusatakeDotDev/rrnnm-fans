import type { Meta, StoryObj } from "@storybook/react-vite";

import Card from "../src/components/Card.tsx";
import Quote from "../src/components/Quote.tsx";
import SectionLabel from "../src/components/SectionLabel.tsx";
import { column } from "./shared/layout.ts";

// 引用文は出典に書かれたとおりに引く。url・label・retrieved（確認日）は必須。
// 見本のために文を作って、公式の概要欄の引用に見せない（出典に実際にある文だけを引く）。
// YouTube のリンクはハンドル（@…）ではなくチャンネル ID の URL にする（ハンドルは本人が変えられる）。
const channel = "https://www.youtube.com/channel/UCnbNzG6tecF6BAdhuv_Tipg";
const source = { url: channel, label: "公式YouTubeチャンネル 概要欄", retrieved: "2026-09-08" };

// args は必須の props の型を満たすためだけに置く。どの story も render で描くので、画面には効かない（Controls も出さない。.storybook/main.ts）。
const meta = { title: "General/Quote", component: Quote, args: source } satisfies Meta<
  typeof Quote
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Short: Story = {
  render: () => (
    <div className="on-paper" style={column}>
      <Quote {...source}>ネモフィラの花から生まれた妖精🌸</Quote>
    </div>
  ),
};

// 青い地の上では Card の白い面に入れて使う。
export const InCard: Story = {
  render: () => (
    <div className="on-ground" style={column}>
      <Card>
        <SectionLabel>プロフィール</SectionLabel>
        <Quote {...source}>ネモフィラの花から生まれた妖精🌸</Quote>
      </Card>
    </div>
  ),
};
