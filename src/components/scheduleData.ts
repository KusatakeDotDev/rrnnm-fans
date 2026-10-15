/**
 * 「今週の配信スケジュール」動画の oEmbed 情報とサムネイルURLの取得。
 * docs/adr/0004-schedule-thumbnail.md。ScheduleCard.astro（ラッパー）と index.astro（`<head>` の preload）から使う。
 *
 * src/lib に置かない。あそこは純関数だけの層（docs/adr/0003-testing-and-ci.md §2）
 * で、fetch を含むこのロジックはそこに置けない。
 *
 * ScheduleCard.astro のフロントマターに直接書かない。`.astro` のフロントマターは
 * コンポーネントのレンダー関数の本体にコンパイルされ、トップレベルの変数もレンダー
 * ごとに再初期化される（import 文だけがモジュールスコープに残る）。トップでは index.astro（`<head>` の preload 用）と
 * ScheduleCard.astro の両方が `getSchedule()` を呼ぶので、フロントマター側に `let` でキャッシュを持っても効かない。ここを .ts モジュールに
 * 切り出し、モジュールスコープの Promise でキャッシュすることで、同じ astro build
 * プロセス内では oEmbed fetch・maxresdefault の存在確認 HEAD がそれぞれ1回だけになる。
 */
import { isOEmbed, oembedAuthor, oembedUrl, type OEmbed } from '../lib/youtube';
import { SCHEDULE_VIDEO_ID, WATCH_URL } from './schedule';
import type { ScheduleCardProps } from './ScheduleCard.tsx';

// YouTube 側の応答が詰まった場合に astro build がブロックされ続けないための上限。
const FETCH_TIMEOUT_MS = 5_000;

/** 取れたときの形。描く側（ScheduleCard.tsx の props）の型から作り、2か所に書かない。 */
export type ScheduleData = NonNullable<ScheduleCardProps['schedule']>;
type Thumbnail = ScheduleData['thumbnail'];

async function fetchSchedule(): Promise<ScheduleData | null> {
  let oembed: OEmbed | null = null;
  try {
    const res = await fetch(oembedUrl(WATCH_URL), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.ok) {
      const body: unknown = await res.json();
      if (isOEmbed(body)) {
        oembed = body;
      }
    }
  } catch {
    // ビルド環境のネットワーク不調・タイムアウト・動画の削除など。フォールバック表示に落ちる。
  }
  if (!oembed) return null;

  let thumbnail: Thumbnail = {
    url: oembed.thumbnail_url,
    width: oembed.thumbnail_width,
    height: oembed.thumbnail_height,
  };

  // maxresdefault が未生成の動画では、YouTube が数KBの灰色のプレースホルダーを 200 で返すことがあるので、大きさで見分ける。
  // 実物のサムネイルとの境界として十分な余裕を持たせた閾値。
  const MIN_MAXRES_BYTES = 10_000;
  const maxresUrl = `https://i.ytimg.com/vi/${SCHEDULE_VIDEO_ID}/maxresdefault.jpg`;
  try {
    const head = await fetch(maxresUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const length = Number(head.headers.get('content-length') ?? '0');
    if (head.ok && length > MIN_MAXRES_BYTES) {
      thumbnail = { url: maxresUrl, width: 1280, height: 720 };
    }
  } catch {
    // 取れなければ hqdefault のまま。
  }

  return {
    oembed: { title: oembed.title, author_name: oembedAuthor(oembed), provider_name: oembed.provider_name },
    thumbnail,
  };
}

let cached: Promise<ScheduleData | null> | null = null;

/** ビルド中のこのモジュールのライフタイムで1回だけ実際に fetch する。 */
export function getSchedule(): Promise<ScheduleData | null> {
  return (cached ??= fetchSchedule());
}
