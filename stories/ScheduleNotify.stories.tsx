import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import Card from "../src/components/Card.tsx";
import ScheduleNotify from "../src/unreleased/_parts/ScheduleNotify.tsx";
import { pad } from "./shared/layout.ts";

// args は型を満たすためだけに置く。どの story も render で描くので、画面には効かない（Controls も出さない。.storybook/main.ts）。
const meta = {
  title: "General/ScheduleNotify",
  component: ScheduleNotify,
  args: {},
} satisfies Meta<typeof ScheduleNotify>;
export default meta;
type Story = StoryObj<typeof meta>;

// サイトでは、今週の配信予定のカード（Card の中の ScheduleCard の下）に置く。ここに載るのは .tsx だけなので、
// ラッパー（ScheduleNotify.astro）のスクリプトは動かず、押しても切り替わらない。
const frame = { padding: pad, maxWidth: "32rem" };
const inCard = (node: ReactNode) => (
  <div className="on-ground" style={frame}>
    <Card>{node}</Card>
  </div>
);

export const Off: Story = {
  render: () => inCard(<ScheduleNotify state="off" />),
};

export const On: Story = {
  render: () => inCard(<ScheduleNotify state="on" />),
};

// OFF から切り替えている途中。つまみが回る輪になる。
export const Pending: Story = {
  render: () => inCard(<ScheduleNotify state="pending" />),
};

// 切り替えられなかったとき。スイッチは、そのときの本当の位置で描く。
export const Failed: Story = {
  render: () => (
    <div className="on-ground" style={{ ...frame, display: "grid", gap: "1.5rem" }}>
      <Card>
        <ScheduleNotify state="off" failed />
      </Card>
      <Card>
        <ScheduleNotify state="on" failed />
      </Card>
    </div>
  ),
};

// 押せないとき。公開したあとは、案内を設定のページへのリンクにする（helpHref）。
export const Unavailable: Story = {
  render: () => (
    <div className="on-ground" style={{ ...frame, display: "grid", gap: "1.5rem" }}>
      <Card>
        <ScheduleNotify state="denied" helpHref="#" />
      </Card>
      <Card>
        <ScheduleNotify state="ios" helpHref="#" />
      </Card>
      <Card>
        <ScheduleNotify state="unsupported" />
      </Card>
    </div>
  ),
};
