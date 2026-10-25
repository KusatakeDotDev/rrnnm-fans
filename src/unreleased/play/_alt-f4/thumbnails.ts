/**
 * 広告のウィンドウに出すサムネイルを、ブラウザで取る（src/unreleased/play/alt-f4.astro）。
 * 動画は、Worker が中継するチャンネルのフィードの最新のもの。サムネイルの取り方は再生リストのタイルと同じで、oEmbed の
 * `thumbnail_url` をそのまま使い、`https://i.ytimg.com` の画像だけを受け入れる（ADR-0033 の決定。ADR-0008「名前と表紙は、
 * ブラウザで取る」と同じ形）。サムネイルの出どころを変えるときは、このファイルだけを替える。
 */
import { isOEmbed, isYouTubeThumbnail, oembedUrl } from "../../../lib/youtube";
import { VIDEOS_PATH, watchUrl } from "../../../lib/alt-f4";

export interface Thumbnail {
  title: string;
  /** 押したときに開く、動画の視聴ページ。 */
  href: string;
  image: string;
}

const LOAD_TIMEOUT_MS = 8_000;
/** youtube.com へ一度に投げる数。全部を同時に投げると、まとめて制限に掛かったときに全部が落ちる。 */
const CONCURRENCY = 4;

/** チャンネルの最新の動画の ID。取れなければ空。 */
export async function loadVideoIds(): Promise<string[]> {
  try {
    const res = await fetch(VIDEOS_PATH, { signal: AbortSignal.timeout(LOAD_TIMEOUT_MS) });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    return Array.isArray(body) ? body.filter((id): id is string => typeof id === "string") : [];
  } catch {
    // 通信断・タイムアウト・JSON として読めない。チャンネルへの広告に落とす。
    return [];
  }
}

async function loadOne(videoId: string): Promise<Thumbnail | null> {
  const href = watchUrl(videoId);
  try {
    // Cookie もリファラも送らない。プレビューのホスト名を YouTube に渡さない。
    const res = await fetch(oembedUrl(href), {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!isOEmbed(body) || !isYouTubeThumbnail(body.thumbnail_url)) return null;
    // ウィンドウは連鎖で 50 ms おきに出るので、出てから読み始めると空の枠が並ぶ。先に読み終えておく。
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.src = body.thumbnail_url;
    await img.decode();
    return { title: body.title, href, image: body.thumbnail_url };
  } catch {
    // CORS が閉じられた・通信断・タイムアウト・画像が読めない。その動画は出さない。
    return null;
  }
}

/** `videoIds` の順に取り、取れたものだけを返す。どれも取れなければ空。 */
export async function loadThumbnails(videoIds: readonly string[]): Promise<Thumbnail[]> {
  const results: (Thumbnail | null)[] = [];
  let next = 0;
  const worker = async () => {
    while (next < videoIds.length) {
      const i = next++;
      results[i] = await loadOne(videoIds[i]!);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results.filter((thumbnail): thumbnail is Thumbnail => thumbnail !== null);
}
