/**
 * 「今週の配信スケジュール」動画の oEmbed 情報とサムネイルURLの取得。
 * docs/adr/0004-schedule-thumbnail.md。ScheduleCard.astro（ラッパー）と index.astro（`<head>` の preload）から使う。
 *
 * ScheduleCard.astro のフロントマターに直接書かない。`.astro` のフロントマターは
 * コンポーネントのレンダー関数の本体にコンパイルされ、トップレベルの変数もレンダー
 * ごとに再初期化される（import 文だけがモジュールスコープに残る）。トップでは index.astro（`<head>` の preload 用）と
 * ScheduleCard.astro の両方が `getSchedule()` を呼ぶので、フロントマター側に `let` でキャッシュを持っても効かない。ここを .ts モジュールに
 * 切り出し、モジュールスコープの Promise でキャッシュすることで、同じ astro build
 * プロセス内では oEmbed fetch・maxresdefault の存在確認 HEAD がそれぞれ1回だけになる。
 */
import { fetchErrorReason, readMaxresHead, readScheduleOEmbed } from '../lib/schedule-oembed';
import { oembedUrl } from '../lib/youtube';
import { SCHEDULE_AUTHOR, SCHEDULE_VIDEO_ID, WATCH_URL } from './schedule';
import type { ScheduleCardProps } from '../components/ScheduleCard.tsx';

// YouTube 側の応答が詰まった場合に astro build がブロックされ続けないための上限。
const FETCH_TIMEOUT_MS = 5_000;

const MAXRES_URL = `https://i.ytimg.com/vi/${SCHEDULE_VIDEO_ID}/maxresdefault.jpg`;

/** 取れたときの形。描く側（ScheduleCard.tsx の props）の型から作り、2か所に書かない。 */
export type ScheduleData = NonNullable<ScheduleCardProps['schedule']>;

async function fetchOEmbed(): Promise<ReturnType<typeof readScheduleOEmbed>> {
  try {
    const res = await fetch(oembedUrl(WATCH_URL), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    // エラーの本文は使わない。読むと、受信が詰まったときにタイムアウトまで待ち、ログにも HTTP の状態が残らない。
    return readScheduleOEmbed(res, res.ok ? await res.text() : '');
  } catch (error) {
    // ビルド環境のネットワーク不調・タイムアウトなど。投げたままにすると、ビルドごと落ちる。
    return { ok: false, reason: fetchErrorReason(error) };
  }
}

async function fetchMaxres(): Promise<ReturnType<typeof readMaxresHead>> {
  try {
    const head = await fetch(MAXRES_URL, { method: 'HEAD', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return readMaxresHead({ ok: head.ok, status: head.status, contentLength: head.headers.get('content-length') });
  } catch (error) {
    return { ok: false, reason: fetchErrorReason(error) };
  }
}

/** 取れなかったときは、理由をビルドのログに出す（goods-images.ts と同じ形）。Release が止まったときに、ログで見分けられるように。 */
async function fetchSchedule(): Promise<ScheduleData | null> {
  const fetched = await fetchOEmbed();
  if (!fetched.ok) {
    console.warn(`[schedule] ${WATCH_URL} の oEmbed を取れなかった: ${fetched.reason}`);
    return null;
  }
  const { title, author_name, provider_name, thumbnail } = fetched.oembed;
  const card = { title, author_name: author_name ?? SCHEDULE_AUTHOR, provider_name };
  const maxres = await fetchMaxres();
  if (maxres.ok) return { oembed: card, thumbnail: { url: MAXRES_URL, width: 1280, height: 720 } };
  if (thumbnail === undefined) {
    console.warn(`[schedule] ${MAXRES_URL} を使えず、oEmbed にも画像が無い: ${maxres.reason}`);
    return null;
  }
  console.warn(`[schedule] ${MAXRES_URL} を使わず、oEmbed の画像にする: ${maxres.reason}`);
  return { oembed: card, thumbnail };
}

let cached: Promise<ScheduleData | null> | null = null;

/** ビルド中のこのモジュールのライフタイムで1回だけ実際に fetch する。 */
export function getSchedule(): Promise<ScheduleData | null> {
  return (cached ??= fetchSchedule());
}
