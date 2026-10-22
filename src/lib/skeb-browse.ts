/**
 * Skeb の作品一覧の、ピックアップ・並べ替え・タグの絞り込み（src/unreleased/_parts/SkebWorks.astro）。
 * DOM に触らない（ADR-0003「層1 — 純関数だけを置く」）。
 */
import { shuffle } from './shuffle';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の日付（YYYY-MM-DD）。見る人の端末の時間帯によらず、ピックアップを同じ時刻に切り替えるため。 */
export function jstDateKey(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** その日のピックアップの位置。同じ日に見た人には同じ作品を出すため、日付だけから決める（FNV-1a）。 */
export function dailyIndex(dateKey: string, length: number): number {
  if (!Number.isInteger(length) || length < 1) throw new RangeError('length must be a positive integer');
  let hash = 0x811c9dc5;
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % length;
}

/**
 * 今の位置とは別の位置を、残りから等しい確率で1つ選ぶ。「別の作品を引く」で同じ作品が続かないように。
 * 1件しか無ければ今の位置を返す。`random` は `Math.random` と同じ契約（0 以上 1 未満）。
 */
export function drawOther(length: number, current: number, random: () => number): number {
  if (length < 2) return current;
  const pick = Math.floor(random() * (length - 1));
  return pick >= current ? pick + 1 : pick;
}

export type WorkOrder = 'asc' | 'desc' | 'shuffle';

export function isWorkOrder(value: string): value is WorkOrder {
  return value === 'asc' || value === 'desc' || value === 'shuffle';
}

/** 作品番号の順（`asc`・`desc`）か、混ぜた順に並べる。渡した配列は書き換えない。 */
export function arrange<T>(items: readonly T[], numberOf: (item: T) => number, order: WorkOrder, random: () => number): T[] {
  if (order === 'shuffle') return shuffle(items, random);
  const sign = order === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const diff = numberOf(a) - numberOf(b);
    // Stryker disable next-line ArithmeticOperator: 作品番号は作品ごとに違い、差が 0 にならないので、掛けても割っても符号が同じ
    return sign * diff;
  });
}

/**
 * 絞り込みに出すタグ。2作品以上に付いたものを多い順（同数なら先に出た順）に並べる。
 * 1作品だけのタグで絞っても1件しか残らず、ボタンが並ぶだけになるため。
 */
export function sharedTags(tagLists: readonly (readonly string[])[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const tags of tagLists) {
    for (const tag of new Set(tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count >= 2)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}
