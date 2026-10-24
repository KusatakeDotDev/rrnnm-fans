import type { Meta, StoryObj } from "@storybook/react-vite";

import Twitter from "../src/components/Twitter.tsx";
import { column } from "./shared/layout.ts";

const meta = { title: "General/Twitter", component: Twitter } satisfies Meta<typeof Twitter>;
export default meta;
type Story = StoryObj<typeof meta>;

// 文の中に置く。「Twitter」にホバーすると「新X」と出る（title 属性）。
// 文は、サービスを指すもの（.design-sync/conventions.md の使い分け）で、事実だけを言うもの（docs/FACTS.md §2）。
export const InSentence: Story = {
  render: () => (
    <div className="on-paper" style={column}>
      <p style={{ margin: 0 }}>
        瑠璃野ねもさんは、YouTube のほかに <Twitter /> にもアカウントがあります。
      </p>
    </div>
  ),
};
