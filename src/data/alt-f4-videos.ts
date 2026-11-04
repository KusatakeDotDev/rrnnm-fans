/**
 * 「配信をとじろ」（src/pages/play/alt-f4.astro）のウィンドウに出す動画の出どころ（docs/adr/0033-alt-f4-thumbnails.md）。
 * 一覧を返す側（worker/index.ts と src/integrations/alt-f4-videos.ts）だけが読む。ページは返った一覧から回ごとに選ぶだけで、
 * どちらの出どころかを知らない。
 */
import { isCelebrating } from "../lib/alt-f4";
import listed from "./alt-f4-videos.json";

/**
 * - `list` … LISTED_VIDEO_IDS（今の姿のお披露目の 2021-04-26 から、一覧を作った日までの動画と配信）
 * - `feed` … チャンネルのフィードの最新15件（ショートを除く）
 */
export type VideoSource = "list" | "feed";

/** 今の出どころ。登録者10万人の記念の特別仕様のあいだは一覧、終わったらフィード。 */
export function currentVideoSource(now: number = Date.now()): VideoSource {
  return isCelebrating(now) ? "list" : "feed";
}

// TODO(RRNNM-114): 特別仕様が終わったら、一覧（alt-f4-videos.json）と、それを返す分岐を消す
/** scripts/alt-f4-videos.mjs が作るスナップショット。 */
export const LISTED_VIDEO_IDS: readonly string[] = listed;
