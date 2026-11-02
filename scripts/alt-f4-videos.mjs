/**
 * 「広告をとじろ」の広告に出す動画の一覧（src/data/alt-f4-videos.json）を、チャンネルの動画と配信の一覧から作り直す
 * （docs/adr/0033-alt-f4-thumbnails.md）。一覧はスナップショットなので、新しい動画や配信を出したくなったら、作り直して PR を出す。
 *
 * 使い方:
 *   pnpm alt-f4:videos <meta.json>
 *
 * meta.json は、チャンネルの動画と配信（ショートを除く）を YouTube Data API の videos.list で引いた結果の配列で、
 * 1件ごとに id・publishedAt・actualStartTime（配信が始まった時刻。動画は null）を持つ。
 */
import { readFileSync, writeFileSync } from "node:fs";

const OUTPUT = new URL("../src/data/alt-f4-videos.json", import.meta.url);
/** 今の姿のお披露目の日。これより前のサムネイルは、姿が今と違う。 */
const SINCE = Date.parse("2021-04-26T00:00:00+09:00");

const [metaFile] = process.argv.slice(2);
if (!metaFile) {
  console.error("使い方: pnpm alt-f4:videos <meta.json>");
  process.exit(1);
}

// 配信は、枠を立てた時刻ではなく、実際に始まった時刻で見る。
const videos = JSON.parse(readFileSync(metaFile, "utf8"))
  .map((video) => ({ id: video.id, at: Date.parse(video.actualStartTime ?? video.publishedAt) }))
  .filter((video) => /^[\w-]{11}$/.test(video.id) && video.at >= SINCE)
  // 古い順にする。作り直したときに、増えた分が末尾に並ぶ。
  .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
const ids = [...new Set(videos.map((video) => video.id))];

writeFileSync(OUTPUT, JSON.stringify(ids, null, 2) + "\n");
console.log(`${ids.length}件を書いた`);
