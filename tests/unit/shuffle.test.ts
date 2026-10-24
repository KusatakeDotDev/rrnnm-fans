import fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import { shuffle } from "../../src/lib/shuffle";

/**
 * src/lib/shuffle.ts — 再生リストの表示順を混ぜる（docs/adr/0008-playlist-carousel.md）。
 * 壊れると「並びから1件消える」「同じものが2回出る」の形で出る。
 */

/** 決め打ちの値を順に返す random。尽きたら先頭から繰り返す。 */
const sequence = (values: readonly number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

const unitInterval = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });

describe("docs/adr/0008 — 表示順は訪問ごとに混ぜる", () => {
  it("並べ替えるだけで、増えも減りもしない", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer()),
        fc.array(unitInterval, { minLength: 1 }),
        (items, randoms) => {
          const byValue = (a: number, b: number) => a - b;
          expect(shuffle(items, sequence(randoms)).sort(byValue)).toEqual([...items].sort(byValue));
        },
      ),
    );
  });

  it("渡した配列を書き換えない", () => {
    const items = [1, 2, 3, 4];
    shuffle(items, () => 0);
    expect(items).toEqual([1, 2, 3, 4]);
  });

  it("どの並びにもなりうる — 3件なら6通りすべてが出る", () => {
    // 後ろから i 番目を 0〜i のどれかと入れ替える。3件なら i=2 で3通り、i=1 で2通り。
    // 各回にどれを選ぶかを乱数の値として渡し、6通りの選び方が6通りの並びになることを見る。
    // 偏った混ぜ方（i 番目を自分自身と入れ替えられない、など）はここで6に届かなくなる。
    const seen = new Set<string>();
    for (let pickAt2 = 0; pickAt2 < 3; pickAt2++) {
      for (let pickAt1 = 0; pickAt1 < 2; pickAt1++) {
        const random = sequence([(pickAt2 + 0.5) / 3, (pickAt1 + 0.5) / 2]);
        seen.add(shuffle(["a", "b", "c"], random).join(""));
      }
    }
    expect(seen.size).toBe(6);
  });

  it("乱数が常に 1 の手前なら元の並びのまま — 自分自身との入れ替えも選べる", () => {
    expect(shuffle([1, 2, 3, 4], () => 0.999)).toEqual([1, 2, 3, 4]);
  });

  it("乱数が常に 0 なら、毎回先頭と入れ替わる", () => {
    expect(shuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1]);
  });

  it("0件と1件はそのまま", () => {
    expect(shuffle([], Math.random)).toEqual([]);
    expect(shuffle(["a"], Math.random)).toEqual(["a"]);
  });
});
