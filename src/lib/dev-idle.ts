/**
 * 使われていない開発サーバー（`pnpm dev`）を止めるかどうかの判断（rurino-nemo-fansite#140）。止める側は
 * src/integrations/dev-idle.ts の `dev-idle-shutdown`。時刻とブラウザの数は呼ぶ側が渡す。
 *
 * 決まりは2つ。どちらかに当たったら止める。
 * - **誰も使っていない**: ページを開いているブラウザ（Vite の HMR の接続）が1つも無く、リクエストも来ないまま
 *   `idleMs` たった
 * - **開いたまま放ってある**: ブラウザがつながっていても、リクエストが来ないまま `maxMs` たった
 *   （ページを開いたままのタブは HMR でつながり続けるので、1つめの決まりだけでは止まらない）
 */

export interface DevIdleLimits {
  /** 誰も使っていないまま、これだけたったら止める（ミリ秒）。Infinity なら止めない。 */
  readonly idleMs: number;
  /** リクエストが来ないまま、これだけたったら止める（ミリ秒）。Infinity なら止めない。 */
  readonly maxMs: number;
}

/** 時刻はどれもミリ秒。 */
export interface DevIdleState {
  readonly now: number;
  /** つながっているブラウザの数。分からないとき（Vite が数を出さなくなったとき）は null。 */
  readonly browsers: number | null;
  /** 最後にブラウザがつながっていた時刻。立ち上げた時刻から始める。 */
  readonly lastBrowserAt: number;
  /** 最後にリクエストが来た時刻。立ち上げた時刻から始める。 */
  readonly lastRequestAt: number;
}

export type DevIdleReason = 'idle' | 'max';

/**
 * 止めるなら、当たった決まり（`idle` か `max`）を返す。まだなら null。
 * ブラウザの数が分からないときは、誰も使っていないとは言えないので、`idle` では止めない。
 */
export function devIdleReason(state: DevIdleState, limits: DevIdleLimits): DevIdleReason | null {
  const lastUsedAt = Math.max(state.lastBrowserAt, state.lastRequestAt);
  if (state.browsers === 0 && state.now - lastUsedAt >= limits.idleMs) return 'idle';
  if (state.now - state.lastRequestAt >= limits.maxMs) return 'max';
  return null;
}

/** 見回りの間が、決めた間隔のこの倍より空いたら、PC が眠っていたとみなす。 */
export const DEV_IDLE_SLEEP_FACTOR = 3;

/**
 * 前の見回りから今までに、PC が眠っていたか。呼ぶ側はこれが true なら数え直す。
 * 呼ぶ側の時計（performance.now()）が眠っている間も進む環境だと、眠っていた時間を「使われていない時間」に数えて、
 * 蓋を開けて戻ってきた直後に止まってしまうため。Linux・macOS の時計は眠っている間に進まないので、そこでは
 * もともと数えず、これも true にならない。Windows で進むかは確かめていない。
 * 見回りが重い処理で遅れただけでも true になりうるが、そのときは止まるのが少し遅れるだけで済む。
 */
export function sleptSince(lastCheckAt: number, now: number, checkMs: number): boolean {
  return now - lastCheckAt > checkMs * DEV_IDLE_SLEEP_FACTOR;
}

/**
 * Astro が書いた開発サーバーの lockfile（`.astro/dev.json`）の中身が、pid が `pid` のプロセスのものか。
 * 読めない・形が違うときは false（消さない側に倒す）。
 */
export function isOwnLockFile(content: string, pid: number): boolean {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    // JSON でなければ data は undefined のまま。下で false になる。
  }
  // 数・文字列・null・undefined なら pid は読めず undefined になるので、形を別に確かめなくてよい。
  return (data as { pid?: unknown } | null | undefined)?.pid === pid;
}

/** 環境変数に書ける分の形。0 以上の10進の数（小数も可）。 */
const DECIMAL_MINUTES = /^\d+(?:\.\d+)?$/;

/**
 * 環境変数で渡された分（小数も可）をミリ秒にする。未設定・空なら `fallbackMinutes`、0 なら止めない（Infinity）。
 * 数でない・負の値は、黙って既定に戻さず投げる（打ち間違えたまま止まらない・すぐ止まる、を避ける）。
 */
export function parseIdleMinutes(value: string | undefined, fallbackMinutes: number): number {
  const text = value?.trim() ?? '';
  if (text === '') return fallbackMinutes * 60_000;
  // Number() に任せると `0x10`（16 分）や `1e-9` も通ってしまうので、形を先に見る。
  if (!DECIMAL_MINUTES.test(text)) {
    throw new TypeError(`分は 0 以上の数で書く（0 で止めない）: ${value}`);
  }
  const minutes = Number(text);
  return minutes === 0 ? Infinity : minutes * 60_000;
}
