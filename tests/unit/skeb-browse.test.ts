import fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import {
  arrange,
  dailyIndex,
  drawOther,
  isWorkOrder,
  jstDateKey,
  sharedTags,
} from "../../src/lib/skeb-browse";

/**
 * src/lib/skeb-browse.ts — Skeb の作品一覧のピックアップ・並べ替え・タグの絞り込み。
 * 壊れると「日付の変わり目がずれる」「別の作品を引いても同じ作品が出る」「並べ替えで作品が消える」の形で出る。
 */

const unitInterval = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });

describe("jstDateKey — ピックアップは日本時間の0時に切り替わる", () => {
  it("UTC の 15:00 が日本時間の日付の変わり目", () => {
    expect(jstDateKey(new Date("2026-10-13T14:59:59.999Z"))).toBe("2026-10-13");
    expect(jstDateKey(new Date("2026-10-13T15:00:00.000Z"))).toBe("2026-10-14");
  });

  it("月と年もまたぐ", () => {
    expect(jstDateKey(new Date("2026-12-31T15:00:00.000Z"))).toBe("2027-01-01");
  });
});

describe("dailyIndex — 同じ日なら誰が見ても同じ作品", () => {
  it("FNV-1a（32ビット）の値を件数で割った余り", () => {
    // FNV-1a の公開されている検査値。件数を 2^32 にすると、ハッシュの値がそのまま返る。
    expect(dailyIndex("", 2 ** 32)).toBe(0x811c9dc5);
    expect(dailyIndex("a", 2 ** 32)).toBe(0xe40c292c);
    expect(dailyIndex("foobar", 2 ** 32)).toBe(0xbf9cf968);
    expect(dailyIndex("foobar", 17)).toBe(0xbf9cf968 % 17);
  });

  it("いつも 0 以上・件数未満", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 1000 }), (key, length) => {
        const index = dailyIndex(key, length);
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(length);
      }),
    );
  });

  it("1年のうちに、17件のどれもが選ばれる", () => {
    const seen = new Set<number>();
    for (let day = 0; day < 365; day++) {
      seen.add(dailyIndex(jstDateKey(new Date(Date.UTC(2026, 0, 1 + day))), 17));
    }
    expect(seen.size).toBe(17);
  });

  it("件数が正の整数でなければ投げる", () => {
    for (const length of [0, -1, 1.5, Number.NaN]) {
      expect(() => dailyIndex("2026-10-14", length)).toThrow(
        new RangeError("length must be a positive integer"),
      );
    }
    expect(dailyIndex("2026-10-14", 1)).toBe(0);
  });
});

describe("drawOther — 「別の作品を引く」", () => {
  it("今の位置は選ばない", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 50 }),
        fc.nat(),
        unitInterval,
        (length, seed, random) => {
          const current = seed % length;
          const next = drawOther(length, current, () => random);
          expect(next).not.toBe(current);
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThan(length);
        },
      ),
    );
  });

  it("今の位置のほかは、どれも選びうる", () => {
    const picks = [0, 1, 2, 3].map((k) => drawOther(5, 2, () => (k + 0.5) / 4));
    expect(picks).toEqual([0, 1, 3, 4]);
  });

  it("乱数が 0 なら先頭、ただし今が先頭ならその次", () => {
    expect(drawOther(5, 3, () => 0)).toBe(0);
    expect(drawOther(5, 0, () => 0)).toBe(1);
  });

  it("1件以下なら今の位置のまま", () => {
    expect(drawOther(1, 0, () => 0.5)).toBe(0);
    expect(drawOther(0, 0, () => 0.5)).toBe(0);
  });
});

describe("isWorkOrder — 並び順の選択肢", () => {
  it("3つだけを受け付ける", () => {
    expect(["asc", "desc", "shuffle"].every(isWorkOrder)).toBe(true);
    expect(["", "ASC", "random"].some(isWorkOrder)).toBe(false);
  });
});

describe("arrange — 作品番号の順と、混ぜた順", () => {
  const items = [{ n: 3 }, { n: 1 }, { n: 17 }, { n: 2 }];
  const numberOf = (item: { n: number }) => item.n;

  it("番号の小さい順・大きい順", () => {
    expect(arrange(items, numberOf, "asc", Math.random).map(numberOf)).toEqual([1, 2, 3, 17]);
    expect(arrange(items, numberOf, "desc", Math.random).map(numberOf)).toEqual([17, 3, 2, 1]);
  });

  it("混ぜるときは渡した乱数で混ぜる", () => {
    expect(arrange(items, numberOf, "shuffle", () => 0).map(numberOf)).toEqual([1, 17, 2, 3]);
  });

  it("渡した配列を書き換えない", () => {
    arrange(items, numberOf, "desc", Math.random);
    expect(items.map(numberOf)).toEqual([3, 1, 17, 2]);
  });
});

describe("sharedTags — 絞り込みに出すタグ", () => {
  it("2作品以上に付いたタグを、多い順に数と一緒に返す", () => {
    expect(
      sharedTags([["切ない", "コメディ"], ["コメディ"], ["独白", "切ない"], ["コメディ"]]),
    ).toEqual([
      { tag: "コメディ", count: 3 },
      { tag: "切ない", count: 2 },
    ]);
  });

  it("同じ数なら先に出た順", () => {
    expect(
      sharedTags([
        ["b", "a"],
        ["a", "b"],
      ]).map(({ tag }) => tag),
    ).toEqual(["b", "a"]);
  });

  it("1つの作品に同じタグが重なっても1作品と数える", () => {
    expect(sharedTags([["a", "a"]])).toEqual([]);
  });

  it("タグが無ければ空", () => {
    expect(sharedTags([])).toEqual([]);
    expect(sharedTags([[], []])).toEqual([]);
  });
});
