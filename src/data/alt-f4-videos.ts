/**
 * 「広告をとじろ」（src/unreleased/play/alt-f4.astro）の広告に出す動画の出どころ（docs/adr/0033-alt-f4-thumbnails.md）。
 * 一覧を返す側（worker/index.ts と src/integrations/alt-f4-videos.ts）だけが読む。ページは返った一覧から回ごとに選ぶだけで、
 * どちらの出どころかを知らない。
 */
import listed from "./alt-f4-videos.json";

/**
 * - `list` … LISTED_VIDEO_IDS（今の姿のお披露目の 2021-04-26 から、一覧を作った日までの動画と配信）
 * - `feed` … チャンネルのフィードの最新15件（ショートを除く）
 */
export type VideoSource = "list" | "feed";

/** 今の出どころ。替えるときは、ここだけを書き換える。 */
export const VIDEO_SOURCE: VideoSource = "list";

/** scripts/alt-f4-videos.mjs が作るスナップショット。 */
export const LISTED_VIDEO_IDS: readonly string[] = listed;
