/**
 * SNS に貼られたときの画像（OGP の og:image）。サイト全体で1枚。
 * 読むのは Base.astro（og:image のタグ）と scripts/generate-og-image.mjs（この名前で書き出す）。
 *
 * **ファイル名の日付は、その絵を作った日**（PR rurino-nemo-fansite#147）。SNS は画像を URL ごとにキャッシュするので、同じ名前のまま
 * 絵を差し替えると、貼り直しても古い絵が出続けることがある。絵を変えるときは、ここの日付をその日にして
 * `pnpm og:image` を回す。日付が前の日のまま絵だけが変わったときは、スクリプトが書き出さずに止まる
 * （同じ日のうちは、作業中に何度も直すので書き直す）。
 *
 * `hash` は、その絵のフィンガープリント（scripts/og-image-svg.ts の ogImageHash）。スクリプトが書き換える。手で書かない。
 * ロゴか色を変えて回し忘れると、tests/repo/og-image.test.ts が落ちる。
 *
 * `src/lib` に置かないのは、あそこが純関数だけの層でミューテーションテストの対象だから。
 */
export const OG_IMAGE = {
  path: "/og/site.20261007.png",
  width: 1200,
  height: 630,
  hash: "346a8c55298c394e",
} as const;
