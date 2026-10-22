import type { Meta, StoryObj } from '@storybook/react-vite';

import Card from '../src/components/Card.tsx';
import ScheduleCard from '../src/components/ScheduleCard.tsx';
import { pad } from './shared/layout.ts';

// args は必須の props の型を満たすためだけに置く。どの story も render で描くので、画面には効かない（Controls も出さない。.storybook/main.ts）。
const meta = {
  title: 'General/ScheduleCard',
  component: ScheduleCard,
  args: { schedule: null },
} satisfies Meta<typeof ScheduleCard>;
export default meta;
type Story = StoryObj<typeof meta>;

// サイトではビルド時に YouTube の oEmbed から取った値が入る（ラッパーの ScheduleCard.astro が取る）。
// サイトでは、サムネイルの枠に YouTube が配る画像しか入れない。下の SVG は見本だけの例外で、
// 本物のサムネイルを直に置ける場所が ADR-0004・ADR-0008 の例外に限られるため、仮の画像にしている。
// タイトルも仮のもの。
const placeholder =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#cfe0f7"/><text x="640" y="380" font-size="56" text-anchor="middle" fill="#1b2a6b" font-family="sans-serif">YouTube サムネイル（見本）</text></svg>',
  );

const ground = { padding: pad, maxWidth: '32rem' };

export const WithThumbnail: Story = {
  render: () => (
    <div className="on-ground" style={ground}>
      <Card>
        <ScheduleCard
          schedule={{
            oembed: {
              title: '（見本）今週の配信スケジュールの動画タイトル',
              author_name: '瑠璃野ねも',
              provider_name: 'YouTube',
            },
            thumbnail: { url: placeholder, width: 1280, height: 720 },
          }}
        />
      </Card>
    </div>
  ),
};

// 作者名を渡さなかったとき。カードはそのまま描き、出典の行は「出典：＜タイトル＞」になる。
export const WithoutAuthor: Story = {
  render: () => (
    <div className="on-ground" style={ground}>
      <Card>
        <ScheduleCard
          schedule={{
            oembed: { title: '（見本）今週の配信スケジュールの動画タイトル', provider_name: 'YouTube' },
            thumbnail: { url: placeholder, width: 1280, height: 720 },
          }}
        />
      </Card>
    </div>
  ),
};

// 取得できなかったとき（null）はテキストリンクに落ちる。
export const Fallback: Story = {
  render: () => (
    <div className="on-ground" style={ground}>
      <Card>
        <ScheduleCard schedule={null} />
      </Card>
    </div>
  ),
};
