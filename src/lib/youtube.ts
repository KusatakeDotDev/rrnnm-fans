/**
 * YouTube oEmbed のリクエスト先と、再生リストの応答の読み方・表紙として受け入れる画像の条件（ADR-0008「名前と表紙は、ブラウザで取る」）。
 *
 * **ブラウザ（PlaylistGrid.astro）と監視（scripts/check-playlists.mjs）とビルド時の予定（src/data/schedule-oembed.ts）が
 * 同じリクエスト先を使う。** 予定の応答だけは、待機所の最小限の応答も読むので、src/lib/schedule-oembed.ts が別に読む（RRNNM-106）。
 * fetch はしない（ADR-0003「層1 — 純関数だけを置く」）。
 */

export interface OEmbed {
  title: string;
  provider_name: string;
  thumbnail_url: string;
  thumbnail_width: number;
  thumbnail_height: number;
}

/** ADR-0008 の例外が掛かるのは、YouTube が配信する画像だけ。 */
const THUMBNAIL_ORIGIN = "https://i.ytimg.com";

/** `url`（動画の視聴ページ、または再生リストのページ）の oEmbed を返すエンドポイント。 */
export function oembedUrl(url: string): string {
  return `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
}

/**
 * oEmbed の応答として読んでよい形か。200 でも、中身が期待した形（部分的な JSON・エラーペイロード等）でないことがある。
 */
export function isOEmbed(value: unknown): value is OEmbed {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === "string" &&
    typeof v.provider_name === "string" &&
    typeof v.thumbnail_url === "string" &&
    typeof v.thumbnail_width === "number" &&
    typeof v.thumbnail_height === "number"
  );
}

/**
 * 表紙として `<img>` に入れてよい URL か。`https://i.ytimg.com` の画像だけを通す。
 *
 * **文字列の前方一致で見ない。** `https://i.ytimg.com.example.com/` や
 * `https://i.ytimg.com@example.com/` のように、見た目は i.ytimg.com でも別のホストを指す URL がある。
 * 解釈したうえでオリジンを比べる。
 */
export function isYouTubeThumbnail(url: string): boolean {
  try {
    return new URL(url).origin === THUMBNAIL_ORIGIN;
  } catch {
    return false;
  }
}
