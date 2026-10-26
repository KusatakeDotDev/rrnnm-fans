/**
 * 広告のウィンドウを閉じるミニゲーム（src/unreleased/play/alt-f4.astro）のうち、DOM に触らないところ（ADR-0003「層1 — 純関数だけを置く」）。
 *
 * 位置は、デスクトップ（ウィンドウを出す面）の左上からの px。ウィンドウの左上の角の位置で持つ。
 * `random` は `Math.random` と同じ契約（0 以上 1 未満を返す）の関数。テストで決め打ちできるよう注入にする。
 */

/**
 * 広告に出す動画の ID の一覧を返すパス。チャンネルのフィードはブラウザから読めないので、同じオリジンで中継する
 * （ADR-0033 の決定）。本番とテストは Worker（worker/index.ts）、開発サーバーは src/integrations/alt-f4-videos.ts が返す。
 */
export const VIDEOS_PATH = "/play/alt-f4/videos.json";

/** 1回の制限時間（ミリ秒）。 */
export const ROUND_MS = 30_000;
/** ふだんは、この間をおいて1枚ずつ出す（ミリ秒）。 */
export const SPAWN_INTERVAL_MS = 1_000;
/** 連鎖で続けて出す枚数と、その間（ミリ秒）。 */
export const CHAIN_COUNT = 10;
export const CHAIN_INTERVAL_MS = 50;
/** ふだんの1枚を出すときに、代わりに連鎖が起きる確率。 */
export const CHAIN_CHANCE = 0.2;
/** 連鎖が続けて起きて画面が埋まりきらないよう、前の連鎖から空ける時間（ミリ秒）。 */
export const CHAIN_COOLDOWN_MS = 5_000;
/** 連鎖で1枚ずらす幅の、ウィンドウの短いほうの辺に対する割合。 */
export const CHAIN_STEP_RATIO = 0.1;
/** 連鎖は右上へ向かって出始める。 */
export const CHAIN_START_DIRECTION: Direction = { x: 1, y: -1 };
/** 連鎖の1枚めは、端に寄りすぎると最初から跳ね返るので、四辺からこの割合だけ内側に置く。 */
export const CHAIN_START_MARGIN = 0.1;

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 連鎖の進む向き。x・y は 1 か -1。 */
export interface Direction {
  x: 1 | -1;
  y: 1 | -1;
}

/** ウィンドウを置ける左上の角の範囲（0〜max）と、連鎖でずらす幅。 */
export interface Bounds {
  maxX: number;
  maxY: number;
  step: number;
}

/** デスクトップより大きいウィンドウは、左上にそろえる（範囲を 0 にする）。 */
export function boundsOf(desktop: Size, popup: Size): Bounds {
  return {
    maxX: Math.max(0, desktop.width - popup.width),
    maxY: Math.max(0, desktop.height - popup.height),
    step: Math.min(popup.width, popup.height) * CHAIN_STEP_RATIO,
  };
}

/** 範囲の中のどこか。`margin` は、四辺から内側に空ける範囲の割合（0 以上 0.5 未満）。 */
export function randomPosition(bounds: Bounds, random: () => number, margin = 0): Point {
  const along = (max: number) => Math.floor(max * margin + random() * max * (1 - 2 * margin));
  return { x: along(bounds.maxX), y: along(bounds.maxY) };
}

/** 連鎖の次の1枚。範囲の端に着く（越える）向きは、跳ね返して逆に進める。 */
export function chainStep(
  from: Point,
  direction: Direction,
  bounds: Bounds,
): { position: Point; direction: Direction } {
  const along = (at: number, dir: 1 | -1, max: number): [number, 1 | -1] => {
    const next = at + dir * bounds.step;
    if (next > 0 && next < max) return [next, dir];
    const turned = dir === 1 ? -1 : 1;
    // 範囲が1歩より狭いと、跳ね返しても外に出るので、範囲の中に留める。
    return [Math.min(max, Math.max(0, at + turned * bounds.step)), turned];
  };
  const [x, dirX] = along(from.x, direction.x, bounds.maxX);
  const [y, dirY] = along(from.y, direction.y, bounds.maxY);
  return { position: { x, y }, direction: { x: dirX, y: dirY } };
}

/** ふだんの1枚の代わりに、連鎖を起こすか。`lastChainAt` は前の連鎖を起こした時刻（まだ無ければ null）。 */
export function shouldChain(
  now: number,
  lastChainAt: number | null,
  chaining: boolean,
  random: () => number,
): boolean {
  if (chaining) return false;
  if (lastChainAt !== null && now - lastChainAt < CHAIN_COOLDOWN_MS) return false;
  return random() < CHAIN_CHANCE;
}

/** 残りの秒数（切り上げ）。始めた瞬間は制限時間そのもの、時間切れのあとは 0。 */
export function remainingSeconds(elapsed: number): number {
  return Math.max(0, Math.ceil((ROUND_MS - elapsed) / 1000));
}

/** 動画の視聴ページ。 */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}
