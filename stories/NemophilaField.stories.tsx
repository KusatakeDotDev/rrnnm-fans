import type { Meta, StoryObj } from "@storybook/react-vite";

import Marquee from "../src/components/Marquee.tsx";
import NemophilaField from "../src/components/NemophilaField.tsx";
import SiteHeader from "../src/components/SiteHeader.tsx";
import type { FieldState } from "../src/lib/field";
import { FieldHero, lede } from "./shared/FieldHero.tsx";

// args は必須の props の型を満たすためだけに置く。どの story も render で描くので、画面には効かない（Controls も出さない。.storybook/main.ts）。
const meta = {
  title: "General/NemophilaField",
  component: NemophilaField,
  args: { lede },
} satisfies Meta<typeof NemophilaField>;
export default meta;
type Story = StoryObj<typeof meta>;

// トップの一画面目。上に SiteHeader overlay を重ね、すぐ下に Marquee を置く。
// state はヘッダーのロゴにも効く（live で白抜きのロゴ）。
// ページ全体に効くので、1ページに畑は1つだけ置く。
// ここに載るのは .tsx だけなので、ラッパー（NemophilaField.astro）のスクリプトは動かない。
// WebGL の畑は描かれず、CSS のグラデーションの畑になる（ADR-0009 の WebGL2 が無いときの姿）。
const Top = ({ state }: { state?: FieldState }) => (
  <div style={{ position: "relative" }}>
    <SiteHeader overlay />
    <FieldHero state={state} />
    <Marquee />
  </div>
);

export const Day: Story = { render: () => <Top /> };
export const Soon: Story = { render: () => <Top state="soon" /> };
export const Live: Story = { render: () => <Top state="live" /> };
