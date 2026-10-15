/**
 * 再生リストの表示順を訪問ごとに変える（src/components/PlaylistGrid.astro。理由は ADR-0008「カルーセルの形」）。
 * DOM に触らない（ADR-0003「層1 — 純関数だけを置く」）。
 */

/**
 * 並びを混ぜる（Fisher–Yates）。渡した配列は書き換えず、新しい配列を返す。
 *
 * `random` は `Math.random` と同じ契約（0 以上 1 未満を返す）の関数。
 * 注入にしてあるのは、テストで並びを決め打ちできるようにするため。
 */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i >= 1; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
