/**
 * 配信のウィンドウを閉じるミニゲーム（src/pages/play/alt-f4.astro）のうち、DOM に触らないところ（ADR-0003「層1 — 純関数だけを置く」）。
 *
 * 位置は、デスクトップ（ウィンドウを出す面）の左上からの px。ウィンドウの左上の角の位置で持つ。
 * `random` は `Math.random` と同じ契約（0 以上 1 未満を返す）の関数。テストで決め打ちできるよう注入にする。
 */

import { shuffle } from "./shuffle";

/**
 * 配信のウィンドウに出す動画の ID の一覧を返すパス。チャンネルのフィードはブラウザから読めないので、同じオリジンで中継する
 * （ADR-0033 の決定）。本番とテストは Worker（worker/index.ts）、開発サーバーは src/integrations/alt-f4-videos.ts が返す。
 * 一覧の出どころ（src/data/alt-f4-videos.ts）は返す側で替え、ページは替えない。
 */
export const VIDEOS_PATH = "/play/alt-f4/videos.json";

// TODO(RRNNM-114): 特別仕様が終わったら、この時刻と isCelebrating を消す
/**
 * 登録者10万人の記念の特別仕様（配信のウィンドウに全件の一覧から出し、始める前に記念配信を置く）が終わる時刻。11月限定にして、
 * 一覧を作るのに使った API のデータを、30日より長く使わない（ADR-0033「払うもの」）。
 */
export const CELEBRATION_ENDS_AT = Date.parse("2026-12-01T00:00:00+09:00");

/** 特別仕様のあいだか。`now` は `Date.now()` と同じ、ミリ秒の時刻。 */
export function isCelebrating(now: number): boolean {
  return now < CELEBRATION_ENDS_AT;
}

/** 一覧の応答を覚えさせる秒数。`ttl` 秒までで、特別仕様が終わる時刻は越えない。 */
export function maxAgeUntilCelebrationEnds(now: number, ttl: number): number {
  return Math.max(0, Math.min(ttl, Math.floor((CELEBRATION_ENDS_AT - now) / 1000)));
}

/** 1回に配信のウィンドウに出す動画の数。遊ぶ回ごとに youtube.com へ出す oEmbed の数でもある（ADR-0033「払うもの」）。 */
export const VIDEOS_PER_ROUND = 15;

/** 1回に配信のウィンドウに出す動画を、一覧から選ぶ。重ねずに選び、一覧が VIDEOS_PER_ROUND に足りなければ全部を混ぜて返す。 */
export function pickVideos(ids: readonly string[], random: () => number): string[] {
  return shuffle(ids, random).slice(0, VIDEOS_PER_ROUND);
}

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

/** 範囲のまん中。px は整数にそろえる。 */
export function centerPosition(bounds: Bounds): Point {
  return { x: Math.floor(bounds.maxX / 2), y: Math.floor(bounds.maxY / 2) };
}

// TODO(RRNNM-114): 特別仕様が終わったら、始める前の1枚を開き直す時間と幅の、ここから openingWidth までを消す
/** 始める前の1枚を閉じてから、開き直すまでの時間（ミリ秒）。1回めに閉じたとき。 */
export const OPENING_REOPEN_FIRST_MS = 3_000;
/** 開き直すまでの時間は、閉じるたびにこの値へ近づける。0 に近づけると、閉じた瞬間に開き直して、閉じたことが見えなくなる。 */
export const OPENING_REOPEN_MIN_MS = 300;
/** 閉じるたびに、開き直すまでの時間の、下限を越える分に掛ける割合。 */
export const OPENING_REOPEN_RATIO = 0.6;
/** 開き直すたびに、ウィンドウの幅に掛ける割合。 */
export const OPENING_GROWTH = 1.15;

/** 始める前の1枚を、`closedTimes` 回めに閉じたあと、開き直すまでの時間（ミリ秒）。`closedTimes` は 0 から数える。 */
export function openingReopenDelay(closedTimes: number): number {
  return Math.round(
    OPENING_REOPEN_MIN_MS +
      (OPENING_REOPEN_FIRST_MS - OPENING_REOPEN_MIN_MS) * OPENING_REOPEN_RATIO ** closedTimes,
  );
}

/**
 * ウィンドウを広げられる上限の幅（px）。広げても、画像の枠だけが縦横比を保って大きくなり、タイトルバー・文字・余白は大きさを
 * 変えない。`popup` と `image` は、今の幅で測ったウィンドウと画像の枠の大きさ。題名は広げるほど行が減るので、狭いときに測ると
 * 安全側になる。
 */
export function maxPopupWidth(desktop: Size, popup: Size, image: Size): number {
  const fixedWidth = popup.width - image.width;
  const fixedHeight = popup.height - image.height;
  const byHeight = ((desktop.height - fixedHeight) * image.width) / image.height + fixedWidth;
  return Math.floor(Math.max(0, Math.min(desktop.width, byHeight)));
}

/** 開き直した1枚の幅（px）。元の幅 `base` を、開き直した回数だけ広げ、`limit` を越えない。 */
export function openingWidth(base: number, reopened: number, limit: number): number {
  return Math.floor(Math.min(limit, base * OPENING_GROWTH ** reopened));
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

/** 配信を押して開く視聴ページのウィンドウの、中身の大きさ（px）。視聴ページのプレイヤーと題名が収まり、横にスクロールしない。 */
export const AD_WINDOW: Size = { width: 480, height: 360 };

/** 画面のうち、ウィンドウを置ける範囲（タスクバーなどを除く）。`screen.availLeft` などの値（px）。 */
export interface ScreenArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 配信を押したときの `window.open` の features。大きさを指定しないと、ゲームのウィンドウとほぼ同じ大きさで開いて画面を覆うので、
 * 画面の右下の隅に小さく開く。位置は中身の大きさで決め、ツールバーの分は、ブラウザが画面の中に押し戻す。
 */
export function adWindowFeatures(area: ScreenArea): string {
  const left = area.left + Math.max(0, area.width - AD_WINDOW.width);
  const top = area.top + Math.max(0, area.height - AD_WINDOW.height);
  return `popup,noopener,noreferrer,width=${AD_WINDOW.width},height=${AD_WINDOW.height},left=${left},top=${top}`;
}

/** BGM の音量のスライダーの値の上限。下限は 0。 */
export const BGM_LEVEL_MAX = 100;
/** BGM の音量のスライダーの初めの値。曲そのものの音が大きいので、半分から始める。 */
export const BGM_LEVEL = 50;

/** 0〜BGM_LEVEL_MAX の整数の書き方。 */
const LEVEL_PATTERN = /^(?:\d{1,2}|100)$/;

/** 覚えておいたスライダーの値を読む。覚えていないか、スライダーに無い値なら、初めの値にする。 */
export function parseBgmLevel(stored: string | null): number {
  return LEVEL_PATTERN.test(String(stored)) ? Number(stored) : BGM_LEVEL;
}

/** スライダーの値を、音に掛ける大きさ（0〜1）にする。そのまま掛けると、つまみの左の端の近くでしか大きさが変わって聞こえないので、2乗にする。 */
export function bgmGain(level: number): number {
  return (level / BGM_LEVEL_MAX) ** 2;
}
