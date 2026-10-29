import fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import {
  adWindowFeatures,
  boundsOf,
  CHAIN_CHANCE,
  CHAIN_COOLDOWN_MS,
  CHAIN_START_DIRECTION,
  CHAIN_STEP_RATIO,
  chainStep,
  type Direction,
  randomPosition,
  remainingSeconds,
  ROUND_MS,
  shouldChain,
  watchUrl,
} from "../../src/lib/alt-f4";

/**
 * src/lib/alt-f4.ts — 広告のウィンドウを閉じるミニゲーム（src/unreleased/play/alt-f4.astro）の、DOM に触らないところ。
 * 壊れると「ウィンドウがデスクトップの外にはみ出す」「連鎖が端で跳ね返らずに外へ抜ける」「連鎖が続けて起きて画面が埋まる」
 * 「残り時間の表示がずれる」「広告を押して開く視聴ページのウィンドウが、画面を覆う」の形で出る。
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

describe("動画の視聴ページ", () => {
  it("動画の ID を v= に入れる", () => {
    expect(watchUrl("ePLprMQEO2g")).toBe("https://www.youtube.com/watch?v=ePLprMQEO2g");
  });

  it("ID に URL の区切りの文字が入っていても、ほかのパラメータにしない", () => {
    expect(watchUrl("a&list=x")).toBe("https://www.youtube.com/watch?v=a%26list%3Dx");
  });
});

describe("広告を押して開く視聴ページのウィンドウ", () => {
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
