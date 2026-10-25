/**
 * YouTube のチャンネルのフィード（Atom）から、最新の動画の ID を読む（ADR-0033 の決定）。
 * Worker（worker/index.ts）と開発サーバー（src/integrations/alt-f4-videos.ts）が使う。fetch はしない（ADR-0003「層1 — 純関数だけを置く」）。
 */

/** 返す件数の上限。フィードは新しい順に15件だけ返す。 */
export const FEED_LIMIT = 15;

/** チャンネルの URL（`https://www.youtube.com/channel/<ID>`）から、そのチャンネルのフィードの URL を作る。読めなければ null。 */
export function channelFeedUrl(channelUrl: string): string | null {
  const match = /^https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})$/.exec(channelUrl);
  return match ? `https://www.youtube.com/feeds/videos.xml?channel_id=${match[1]}` : null;
}

/**
 * フィードの動画の ID を、フィードの順（新しい順）に返す。ショート（リンクが `/shorts/`）は外す。広告に出すのは動画と配信にしたため
 * （RRNNM-112）。形の違う ID と重なった ID も外し、FEED_LIMIT 件までにする。
 */
export function latestVideoIds(xml: string): string[] {
  const ids: string[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1]!;
    const id = /<yt:videoId>([\w-]{11})<\/yt:videoId>/.exec(entry)?.[1];
    const short = /<link rel="alternate" href="[^"]*\/shorts\//.test(entry);
    if (!id || short || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length === FEED_LIMIT) break;
  }
  return ids;
}
