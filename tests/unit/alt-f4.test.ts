import fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import {
  adWindowFeatures,
  boundsOf,
  CHAIN_CHANCE,
  CHAIN_COOLDOWN_MS,
  CHAIN_START_DIRECTION,
  CELEBRATION_ENDS_AT,
  CHAIN_STEP_RATIO,
  centerPosition,
  chainStep,
  type Direction,
  isCelebrating,
  maxAgeUntilCelebrationEnds,
  maxPopupWidth,
  OPENING_GROWTH,
  OPENING_REOPEN_FIRST_MS,
  OPENING_REOPEN_MIN_MS,
  openingReopenDelay,
  openingWidth,
  pickVideos,
  randomPosition,
  remainingSeconds,
  ROUND_MS,
  shouldChain,
  VIDEOS_PER_ROUND,
  watchUrl,
} from "../../src/lib/alt-f4";

/**
 * src/lib/alt-f4.ts — 配信のウィンドウを閉じるミニゲーム（src/unreleased/play/alt-f4.astro）の、DOM に触らないところ。
 * 壊れると「ウィンドウがデスクトップの外にはみ出す」「連鎖が端で跳ね返らずに外へ抜ける」「連鎖が続けて起きて画面が埋まる」
 * 「残り時間の表示がずれる」「配信を押して開く視聴ページのウィンドウが、画面を覆う」「1回に出す動画が多すぎて、oEmbed を投げすぎる」
 * 「回ごとに選び直しても、同じ動画しか出ない」「始める前の1枚が、閉じた瞬間に開き直して閉じられなくなる」「開き直した1枚が
 * デスクトップからはみ出して、× が切れる」の形で出る。
 */

const unitInterval = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });
const length = fc.integer({ min: 0, max: 2000 });
const direction = fc.record({
  x: fc.constantFrom<1 | -1>(1, -1),
  y: fc.constantFrom<1 | -1>(1, -1),
});

describe("ウィンドウを置ける範囲", () => {
  it("デスクトップの大きさからウィンドウの大きさを引いた分。連鎖でずらす幅は、短いほうの辺の割合", () => {
    expect(boundsOf({ width: 800, height: 600 }, { width: 300, height: 200 })).toEqual({
      maxX: 500,
      maxY: 400,
      step: 200 * CHAIN_STEP_RATIO,
    });
  });

  it("ずらす幅は、縦長のウィンドウでも短いほうの辺から決める", () => {
    expect(boundsOf({ width: 800, height: 600 }, { width: 200, height: 300 }).step).toBe(
      200 * CHAIN_STEP_RATIO,
    );
  });

  it("デスクトップより大きいウィンドウは、左上にそろえる（範囲が負にならない）", () => {
    expect(boundsOf({ width: 300, height: 200 }, { width: 320, height: 260 })).toMatchObject({
      maxX: 0,
      maxY: 0,
    });
  });
});

describe("ふだんの1枚を置く位置", () => {
  it("範囲の中に収まる", () => {
    fc.assert(
      fc.property(length, length, unitInterval, (maxX, maxY, r) => {
        const { x, y } = randomPosition({ maxX, maxY, step: 10 }, () => r);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(maxX);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(maxY);
      }),
    );
  });

  it("乱数の 0 は左上の角、1 に近い値は右下の角の近く。px は整数にそろえる", () => {
    const bounds = { maxX: 500, maxY: 400, step: 10 };
    expect(randomPosition(bounds, () => 0)).toEqual({ x: 0, y: 0 });
    expect(randomPosition(bounds, () => 0.999)).toEqual({ x: 499, y: 399 });
    expect(randomPosition(bounds, () => 0.5)).toEqual({ x: 250, y: 200 });
  });

  it("横と縦で別の乱数を使う（斜めの1本の上にだけ並ばない）", () => {
    const values = [0.25, 0.75];
    let i = 0;
    expect(randomPosition({ maxX: 400, maxY: 400, step: 10 }, () => values[i++]!)).toEqual({
      x: 100,
      y: 300,
    });
  });

  it("内側に空ける割合を渡すと、四辺からその分だけ内側に置く", () => {
    const bounds = { maxX: 1000, maxY: 500, step: 10 };
    expect(randomPosition(bounds, () => 0, 0.1)).toEqual({ x: 100, y: 50 });
    expect(randomPosition(bounds, () => 0.999999, 0.1)).toEqual({ x: 899, y: 449 });
  });
});

describe("始める前に置く1枚の位置", () => {
  it("範囲のまん中。横と縦はそれぞれの範囲から決め、px は整数にそろえる", () => {
    expect(centerPosition({ maxX: 500, maxY: 300, step: 10 })).toEqual({ x: 250, y: 150 });
    expect(centerPosition({ maxX: 501, maxY: 301, step: 10 })).toEqual({ x: 250, y: 150 });
  });

  it("範囲が 0（デスクトップより大きいウィンドウ）なら、左上にそろえる", () => {
    expect(centerPosition({ maxX: 0, maxY: 0, step: 10 })).toEqual({ x: 0, y: 0 });
  });
});

describe("始める前の1枚を閉じてから、開き直すまでの時間", () => {
  it("1回めに閉じたときは、決めた時間で開き直す", () => {
    expect(openingReopenDelay(0)).toBe(OPENING_REOPEN_FIRST_MS);
  });

  it("閉じるたびに、下限を越える分を割合で縮める（ミリ秒は整数にそろえる）", () => {
    expect(openingReopenDelay(1)).toBe(1920);
    expect(openingReopenDelay(2)).toBe(1272);
    expect(openingReopenDelay(3)).toBe(883);
  });

  it("閉じるたびに短くなり、下限より短くはならない", () => {
    let previous = openingReopenDelay(0);
    for (let times = 1; times <= 12; times++) {
      const delay = openingReopenDelay(times);
      expect(delay).toBeLessThan(previous);
      expect(delay).toBeGreaterThan(OPENING_REOPEN_MIN_MS);
      previous = delay;
    }
    expect(openingReopenDelay(100)).toBe(OPENING_REOPEN_MIN_MS);
  });
});

describe("始める前の1枚を広げられる上限の幅", () => {
  // 幅 288 のウィンドウ（画像の枠は 270×151.875、ほかに横 18・縦 90）。
  const popup = { width: 288, height: 241.875 };
  const image = { width: 270, height: 151.875 };

  it("デスクトップの高さに収まるまで。画像の枠だけが縦横比を保って伸び、ほかの部分の高さは変えない", () => {
    // 画像の枠に使える高さは 450 - 90 = 360、その幅は 360 × 16 / 9 = 640、ウィンドウは 640 + 18。
    expect(maxPopupWidth({ width: 1000, height: 450 }, popup, image)).toBe(658);
  });

  it("デスクトップの幅を越えない", () => {
    expect(maxPopupWidth({ width: 330, height: 450 }, popup, image)).toBe(330);
  });

  it("px は整数に切り捨てて、はみ出さないようにする", () => {
    expect(maxPopupWidth({ width: 1000, height: 450.5 }, popup, image)).toBe(658);
    expect(maxPopupWidth({ width: 330.9, height: 450 }, popup, image)).toBe(330);
  });

  it("デスクトップがほかの部分の高さより低くても、負にしない", () => {
    expect(maxPopupWidth({ width: 1000, height: 50 }, popup, image)).toBe(0);
  });
});

describe("開き直した1枚の幅", () => {
  it("開き直した回数だけ広げる。まだ開き直していなければ元の幅のまま", () => {
    expect(openingWidth(288, 0, 1000)).toBe(288);
    expect(openingWidth(288, 1, 1000)).toBe(Math.floor(288 * OPENING_GROWTH));
    expect(openingWidth(288, 2, 1000)).toBe(Math.floor(288 * OPENING_GROWTH ** 2));
  });

  it("上限で止める。元の幅が上限より広くても、上限にそろえる", () => {
    expect(openingWidth(288, 20, 658)).toBe(658);
    expect(openingWidth(288, 0, 250)).toBe(250);
  });

  it("px は整数に切り捨てる", () => {
    expect(openingWidth(100.9, 0, 1000)).toBe(100);
    expect(openingWidth(288, 0, 300.7)).toBe(288);
    expect(openingWidth(288, 9, 300.7)).toBe(300);
  });
});

describe("連鎖の次の1枚", () => {
  const bounds = { maxX: 500, maxY: 400, step: 20 };

  it("連鎖は右上へ向かって出始める", () => {
    expect(CHAIN_START_DIRECTION).toEqual({ x: 1, y: -1 });
  });

  it("範囲の中なら、向きのとおりに1歩ずらす", () => {
    expect(chainStep({ x: 100, y: 100 }, { x: 1, y: -1 }, bounds)).toEqual({
      position: { x: 120, y: 80 },
      direction: { x: 1, y: -1 },
    });
    expect(chainStep({ x: 100, y: 100 }, { x: -1, y: 1 }, bounds)).toEqual({
      position: { x: 80, y: 120 },
      direction: { x: -1, y: 1 },
    });
  });

  it("端にちょうど着く1歩は、跳ね返して逆に進める", () => {
    expect(chainStep({ x: 480, y: 20 }, { x: 1, y: -1 }, bounds)).toEqual({
      position: { x: 460, y: 40 },
      direction: { x: -1, y: 1 },
    });
    expect(chainStep({ x: 20, y: 380 }, { x: -1, y: 1 }, bounds)).toEqual({
      position: { x: 40, y: 360 },
      direction: { x: 1, y: -1 },
    });
  });

  it("端の1つ手前までは、跳ね返さない", () => {
    expect(chainStep({ x: 479, y: 21 }, { x: 1, y: -1 }, bounds)).toEqual({
      position: { x: 499, y: 1 },
      direction: { x: 1, y: -1 },
    });
  });

  it("横だけが端に着いたら、横だけを跳ね返す", () => {
    expect(chainStep({ x: 490, y: 200 }, { x: 1, y: 1 }, bounds)).toEqual({
      position: { x: 470, y: 220 },
      direction: { x: -1, y: 1 },
    });
  });

  it("範囲が1歩より狭いと、範囲の中に留める", () => {
    const narrow = { maxX: 5, maxY: 0, step: 20 };
    expect(chainStep({ x: 3, y: 0 }, { x: 1, y: 1 }, narrow)).toEqual({
      position: { x: 0, y: 0 },
      direction: { x: -1, y: -1 },
    });
    expect(chainStep({ x: 3, y: 0 }, { x: -1, y: -1 }, narrow)).toEqual({
      position: { x: 5, y: 0 },
      direction: { x: 1, y: 1 },
    });
  });

  it("何歩進めても範囲の外に出ない", () => {
    fc.assert(
      fc.property(
        length,
        length,
        fc.integer({ min: 1, max: 200 }),
        unitInterval,
        unitInterval,
        direction,
        fc.integer({ min: 1, max: 60 }),
        (maxX, maxY, step, rx, ry, start, steps) => {
          const b = { maxX, maxY, step };
          let position = { x: Math.floor(rx * maxX), y: Math.floor(ry * maxY) };
          let dir: Direction = start;
          for (let i = 0; i < steps; i++) {
            ({ position, direction: dir } = chainStep(position, dir, b));
            expect(position.x).toBeGreaterThanOrEqual(0);
            expect(position.x).toBeLessThanOrEqual(maxX);
            expect(position.y).toBeGreaterThanOrEqual(0);
            expect(position.y).toBeLessThanOrEqual(maxY);
          }
        },
      ),
    );
  });
});

describe("連鎖を起こすか", () => {
  const hit = () => 0;
  const miss = () => 0.999;

  it("確率に当たれば起こし、外れれば起こさない", () => {
    expect(shouldChain(10_000, null, false, hit)).toBe(true);
    expect(shouldChain(10_000, null, false, miss)).toBe(false);
  });

  it("確率の境目 — 乱数が確率ちょうどなら起こさない", () => {
    expect(shouldChain(10_000, null, false, () => CHAIN_CHANCE)).toBe(false);
    expect(shouldChain(10_000, null, false, () => CHAIN_CHANCE - 1e-9)).toBe(true);
  });

  it("連鎖している最中は、重ねて起こさない", () => {
    expect(shouldChain(10_000, null, true, hit)).toBe(false);
  });

  it("前の連鎖から空ける時間が経つまでは起こさず、経ったら起こす", () => {
    expect(shouldChain(1_000 + CHAIN_COOLDOWN_MS - 1, 1_000, false, hit)).toBe(false);
    expect(shouldChain(1_000 + CHAIN_COOLDOWN_MS, 1_000, false, hit)).toBe(true);
  });

  it("まだ連鎖が無ければ、始めてすぐ（時刻が小さくても）起こせる", () => {
    expect(shouldChain(0, null, false, hit)).toBe(true);
  });
});

describe("残りの秒数", () => {
  it("始めた瞬間は制限時間そのもの", () => {
    expect(remainingSeconds(0)).toBe(ROUND_MS / 1000);
  });

  it("切り上げる — 1ミリ秒でも残っていれば1秒と出す", () => {
    expect(remainingSeconds(1)).toBe(ROUND_MS / 1000);
    expect(remainingSeconds(1000)).toBe(ROUND_MS / 1000 - 1);
    expect(remainingSeconds(ROUND_MS - 1)).toBe(1);
  });

  it("時間切れのあとは 0（負にしない）", () => {
    expect(remainingSeconds(ROUND_MS)).toBe(0);
    expect(remainingSeconds(ROUND_MS + 5_000)).toBe(0);
  });
});

describe("登録者10万人の記念の特別仕様", () => {
  it("2026年11月の終わり（日本時間の 12/1 0:00）で終わる", () => {
    expect(new Date(CELEBRATION_ENDS_AT).toISOString()).toBe("2026-11-30T15:00:00.000Z");
  });

  it("終わる時刻の直前まではそのあいだで、終わる時刻からは外", () => {
    expect(isCelebrating(CELEBRATION_ENDS_AT - 1)).toBe(true);
    expect(isCelebrating(CELEBRATION_ENDS_AT)).toBe(false);
    expect(isCelebrating(CELEBRATION_ENDS_AT + 1)).toBe(false);
  });

  it("一覧を覚えさせる秒数は、決めた秒数までで、終わる時刻を越えない（秒に満たない分は切り捨てる）", () => {
    expect(maxAgeUntilCelebrationEnds(CELEBRATION_ENDS_AT - 3_600_000, 600)).toBe(600);
    expect(maxAgeUntilCelebrationEnds(CELEBRATION_ENDS_AT - 600_000, 600)).toBe(600);
    expect(maxAgeUntilCelebrationEnds(CELEBRATION_ENDS_AT - 90_500, 600)).toBe(90);
    expect(maxAgeUntilCelebrationEnds(CELEBRATION_ENDS_AT - 999, 600)).toBe(0);
    expect(maxAgeUntilCelebrationEnds(CELEBRATION_ENDS_AT, 600)).toBe(0);
    expect(maxAgeUntilCelebrationEnds(CELEBRATION_ENDS_AT + 5_000, 600)).toBe(0);
  });
});

describe("1回に配信のウィンドウに出す動画", () => {
  /** 番号から、重ならない動画の ID の一覧を作る。 */
  const videoIds = (count: number) =>
    Array.from({ length: count }, (_, n) => `video${String(n).padStart(6, "0")}`);

  it("一覧から重ねずに選び、VIDEOS_PER_ROUND 本までにする。一覧が足りなければ全部を出す", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), unitInterval, (count, value) => {
        const ids = videoIds(count);
        const picked = pickVideos(ids, () => value);
        expect(picked).toHaveLength(Math.min(count, VIDEOS_PER_ROUND));
        expect(new Set(picked).size).toBe(picked.length);
        for (const id of picked) expect(ids).toContain(id);
      }),
    );
  });

  it("乱数が違えば、別の動画を選ぶ（回ごとに選び直すと、出る動画が変わる）", () => {
    const ids = videoIds(VIDEOS_PER_ROUND * 3);
    const first = new Set(pickVideos(ids, () => 0));
    const second = pickVideos(ids, () => 0.99);
    expect(second.some((id) => !first.has(id))).toBe(true);
  });

  it("渡した一覧を書き換えない", () => {
    const ids = videoIds(VIDEOS_PER_ROUND + 5);
    pickVideos(ids, () => 0);
    expect(ids).toEqual(videoIds(VIDEOS_PER_ROUND + 5));
  });
});

describe("動画の視聴ページ", () => {
  it("動画の ID を v= に入れる", () => {
    expect(watchUrl("ePLprMQEO2g")).toBe("https://www.youtube.com/watch?v=ePLprMQEO2g");
  });

  it("ID に URL の区切りの文字が入っていても、ほかのパラメータにしない", () => {
    expect(watchUrl("a&list=x")).toBe("https://www.youtube.com/watch?v=a%26list%3Dx");
  });
});

describe("配信を押して開く視聴ページのウィンドウ", () => {
  it("画面の右下の隅に、480×360 の小さなウィンドウで開く。開いた側は触れさせない", () => {
    expect(adWindowFeatures({ left: 0, top: 0, width: 1920, height: 1040 })).toBe(
      "popup,noopener,noreferrer,width=480,height=360,left=1440,top=680",
    );
  });

  it("画面を複数つないで、今の画面の左上が 0 でないときも、その画面の右下に置く", () => {
    expect(adWindowFeatures({ left: 1920, top: -200, width: 1280, height: 1000 })).toBe(
      "popup,noopener,noreferrer,width=480,height=360,left=2720,top=440",
    );
  });

  it("画面がウィンドウより小さいと、ウィンドウの左上を画面の左上にそろえる", () => {
    expect(adWindowFeatures({ left: 100, top: 50, width: 400, height: 300 })).toBe(
      "popup,noopener,noreferrer,width=480,height=360,left=100,top=50",
    );
  });
});
