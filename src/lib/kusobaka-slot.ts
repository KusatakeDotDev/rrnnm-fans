/**
 * クソバカスロット（src/pages/kusobaka-slot.astro）のうち、DOM と音に触らないところ（ADR-0003「層1 — 純関数だけを置く」）。
 *
 * リールの位置は、帯の何コマめがまん中に来ているかを小数で持つ。リールは位置が減る向き（字が上から下へ流れる向き）に回る。
 * `random` は `Math.random` と同じ契約（0 以上 1 未満を返す）の関数。テストで決め打ちできるよう注入にする。
 */

/** どのリールの帯もこの順に並ぶ。i 本めの当たりは WORD[i]。 */
export const WORD = ["ク", "ソ", "バ", "カ"] as const;

/** そろうまでの1〜3本めで鳴らすセリフ。名前は src/assets/kusobaka-slot/ の mp3 のファイル名。 */
export const REACTIONS = ["reaction-oo", "reaction-ooh", "reaction-o", "reaction-hya"] as const;

/** 4本そろったときに鳴らすセリフ。 */
export const CHEERS = [
  "cheer-omedetou",
  "cheer-sonochoushi",
  "cheer-panpakapan",
  "cheer-ooatari",
] as const;

/** 期限を過ぎたあと（目押し）に、そろわなかったときに鳴らすセリフ。 */
export const MISSES = ["miss-atochotto", "miss-osshii", "miss-zannen"] as const;

export type Voice = (typeof REACTIONS)[number] | (typeof CHEERS)[number] | (typeof MISSES)[number];

export function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}

/** `stopped` 本め（1 始まり）を止めたときのセリフ。 */
export function voiceFor(stopped: number, random: () => number): Voice {
  return pick(stopped < WORD.length ? REACTIONS : CHEERS, random);
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** 帯は並びを3回重ねて描くので、まん中の回に入れる。上下の隣のコマも、帯の中に収まる。 */
export function stripPosition(position: number): number {
  return WORD.length + mod(position, WORD.length);
}

/** 止めたあとに滑って行き着く位置。今の位置から `minSlide` コマ以上回った先で、最初に `target` 番めの字がまん中に来るところ。 */
export function landing(position: number, target: number, minSlide: number): number {
  const from = position - minSlide;
  // 止まる位置は字のコマちょうど（整数）。小数の引き算の誤差（-1.0000000000000002 など）を丸めて消す。
  return Math.round(from - mod(from - target, WORD.length));
}

/** `distance` コマ滑って止まるまでの時間。回っていた速さ（コマ/ミリ秒）から、一定の割合で減速する。 */
export function slideDuration(distance: number, speed: number): number {
  return (2 * distance) / speed;
}

/** 期限を過ぎたあと（目押し）に止まる位置。押したときに次にまん中へ来る字で止める。 */
export function nextStop(position: number): number {
  return Math.floor(position);
}

/** まん中に来ている字が、WORD の何番めか。 */
export function charIndex(position: number): number {
  return mod(Math.round(position), WORD.length);
}

/** 滑っているあいだの位置。`slideDuration` の時間をかけて `from` から `to` へ、減速しながら進む。 */
export function slidePosition(from: number, to: number, elapsed: number, duration: number): number {
  // 目押しで字のちょうどまん中で押すと、滑る長さも時間も 0 になる。0 / 0 の NaN を位置にしない。
  if (!(duration > 0)) return to;
  const left = Math.min(1, Math.max(0, 1 - elapsed / duration));
  return to + (from - to) * left * left;
}

/** 元ネタのポストの「今日」。この日のうちは、かならずそろう。 */
export const DEFAULT_UNTIL = "2026-10-18";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 元ネタは日本の「今日」なので、どこから開いても日本時間で区切る。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日付（`YYYY-MM-DD`。`<input type="date">` の値）の日が終わる時刻（日本時間の翌日 0:00）。日付として読めなければ null。 */
export function deadlineOf(date: string): number | null {
  // 年は4桁より長くてもよい（HTML の日付の値の決まり）。Chrome は max が無いと年を6桁まで打たせる。
  const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const start = Date.UTC(year, month - 1, day);
  // Date.UTC は無い日を翌月に（2月30日を3月2日に）、0〜99年を1900年代に、0月と13月以上を前後の年に読み替える。
  // 無い日なら日が、年と月の外れなら年が変わるので、その2つが戻るかを見る。
  const parsed = new Date(start);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCDate() !== day) return null;
  return start + DAY_MS - JST_OFFSET_MS;
}

/** 音を出すときの全体の大きさ（0〜1）。音が出ると知らずに押した人を、いきなり大きな音で驚かせないよう、控えめにする。 */
export const SOUND_LEVEL = 0.4;

export function parseMuted(stored: string | null): boolean {
  return stored === "1";
}
