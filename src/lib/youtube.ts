/**
 * YouTube oEmbed の応答の読み方と、表紙として受け入れる画像の条件（ADR-0008「名前と表紙は、ブラウザで取る」）。
 *
 * **ビルド時（src/data/schedule-oembed.ts）とブラウザ（PlaylistGrid.astro）と
 * 監視（scripts/check-playlists.mjs）が同じ関数を使う。** 条件を2箇所に書くと、片方だけが緩む。
 * fetch はしない（ADR-0003「層1 — 純関数だけを置く」）。
 */

export interface OEmbed {
  title: string;
  /** 投稿したチャンネルの名前。`isOEmbed` は確かめないので型は分からない。読むのは `oembedAuthor` を通す。 */
  author_name?: unknown;
  provider_name: string;
  thumbnail_url: string;
  thumbnail_width: number;
  thumbnail_height: number;
}

/** ADR-0008 の例外が掛かるのは、YouTube が配信する画像だけ。 */
const THUMBNAIL_ORIGIN = 'https://i.ytimg.com';

/** `url`（動画の視聴ページ、または再生リストのページ）の oEmbed を返すエンドポイント。 */
export function oembedUrl(url: string): string {
  return `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
}

/**
 * oEmbed の応答として読んでよい形か。200 でも、中身が期待した形（部分的な JSON・エラーペイロード等）でないことがある。
 */
export function isOEmbed(value: unknown): value is OEmbed {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === 'string' &&
    typeof v.provider_name === 'string' &&
    typeof v.thumbnail_url === 'string' &&
    typeof v.thumbnail_width === 'number' &&
    typeof v.thumbnail_height === 'number'
  );
}

/**
 * oEmbed の応答から作者名（投稿したチャンネルの名前）を読む。文字列でない・空白だけなら `undefined`。
 * 予定のカードの出典の行に出す（docs/adr/0004-schedule-thumbnail.md「出典の行に作者名を出す」）。
 *
 * **`isOEmbed` の必須には入れない。** 使うのは出典の行だけで、無ければ作者名を省いて描けばよい。
 * 必須にすると、作者名が欠けただけで予定のカードがテキストリンクに落ち、使わない再生リストの表紙まで出なくなる。
 */
export function oembedAuthor(oembed: OEmbed): string | undefined {
  const name = oembed.author_name;
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed === '' ? undefined : trimmed;
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
