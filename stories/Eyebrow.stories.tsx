import type { Meta, StoryObj } from "@storybook/react-vite";

import Eyebrow from "../src/components/Eyebrow.tsx";
import { column } from "./shared/layout.ts";

const meta = { title: "General/Eyebrow", component: Eyebrow } satisfies Meta<typeof Eyebrow>;
export default meta;
type Story = StoryObj<typeof meta>;

// 見出しの上に置く小さな肩書き。白い面の中で使う。
export const AboveHeading: Story = {
  render: () => (
    <div className="on-paper" style={column}>
      <Eyebrow>瑠璃野ねも ／ ネモフィラの妖精</Eyebrow>
      <h1 style={{ margin: 0 }}>企画アーカイブ</h1>
    </div>
  ),
};
