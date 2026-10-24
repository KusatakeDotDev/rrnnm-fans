import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import {
  addRipple,
  approach,
  DPR_STEP,
  FIELD_STATES,
  FRAME_WINDOW,
  GUST_DELAY_S,
  GUST_DURATION_S,
  GUST_FROM_Z,
  GUST_TO_Z,
  GROUND_COLUMN_UNIT,
  type FlowerBed,
  groundColumns,
  isSlow,
  MAX_GROUND_VERTICES,
  lowerDpr,
  openingGust,
  parseCssRgb,
  parseFieldMesh,
  parseFieldState,
  placeFlower,
  planFlowers,
  type Ripple,
  RIPPLE_ATTACK_S,
  RIPPLE_DECAY,
  RIPPLE_GONE,
  RIPPLE_RELEASE_S,
  RIPPLE_SLOTS,
  rippleLeft,
  rippleStrength,
  SLOW_FRAME_MS,
  smoothstep,
} from "../../src/lib/field";

/**
 * src/lib/field.ts — トップのネモフィラ畑の計算（docs/adr/0009-nemophila-field-hero.md）。
 *
 * 描画そのもの（WebGL）はここでは見ない。ここにあるのは、壊れると
 * 「知らない状態で畑が真っ黒になる」「色が読めずに全部黒になる」
 * 「フレームの間隔で風の強さが変わる」の形で出るものだけ。
 */

describe("ADR-0009 §状態 — 知らない値はふだんに落ちる", () => {
  it.each(FIELD_STATES)("%s はそのまま読める", (state) => {
    expect(parseFieldState(state)).toBe(state);
  });

  it.each([undefined, null, "", "LIVE", " live", "night"])("%j はふだん", (value) => {
    expect(parseFieldState(value)).toBe("day");
  });
});

describe("ADR-0009 §色 — 色は CSS から読む", () => {
  it.each([
    ["rgb(255, 102, 51)", [1, 0.4, 0.2]],
    ["rgba(255, 0, 51, 0.5)", [1, 0, 0.2]],
    ["rgba(255,0,51,0.5)", [1, 0, 0.2]],
    ["rgb(255 0 51 / 50% )", [1, 0, 0.2]],
    ["rgb(255 0 51)", [1, 0, 0.2]],
    ["rgb(255 0 51 / 50%)", [1, 0, 0.2]],
    ["  rgb(0, 0, 0)  ", [0, 0, 0]],
  ])("%s", (value, expected) => {
    const rgb = parseCssRgb(value);
    expect(rgb).toHaveLength(3);
    rgb!.forEach((channel, i) => expect(channel).toBeCloseTo(expected[i]!, 5));
  });

  it.each([
    "",
    "#FFFFFF",
    "transparent",
    "rgb(1, 2)",
    "rgb(256, 0, 0)",
    "hsl(0, 0%, 0%)",
    "rgb(1, 2, 3) x",
    "x rgb(1, 2, 3)",
  ])("%j は読めない", (value) => {
    expect(parseCssRgb(value)).toBeNull();
  });
});

describe("ADR-0009 §動き — フレームの間隔に左右されない", () => {
  const finite = fc.double({ min: -1e3, max: 1e3, noNaN: true });
  const dt = fc.double({ min: 0, max: 1, noNaN: true });
  const rate = fc.double({ min: 0.1, max: 20, noNaN: true });

  it("時間が経たなければ動かない", () => {
    fc.assert(
      fc.property(finite, finite, rate, (a, b, r) => {
        // toBe（Object.is）は -0 と 0 を別物にする。a が -0 だと結果は 0 になり、
        // 動いていないのに落ちる（fast-check が -0 を引いたときだけ落ちる、揺れるテストになる）。
        // 数として同じかを見る。
        expect(approach(a, b, 0, r) === a).toBe(true);
      }),
    );
  });

  it("行き過ぎない — いつも今と目標のあいだにいる", () => {
    fc.assert(
      fc.property(finite, finite, dt, rate, (a, b, d, r) => {
        const next = approach(a, b, d, r);
        expect(next).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9);
        expect(next).toBeLessThanOrEqual(Math.max(a, b) + 1e-9);
      }),
    );
  });

  it("2回に分けて進めても、まとめて進めても同じところに着く", () => {
    fc.assert(
      fc.property(finite, finite, dt, dt, rate, (a, b, d1, d2, r) => {
        const split = approach(approach(a, b, d1, r), b, d2, r);
        expect(split).toBeCloseTo(approach(a, b, d1 + d2, r), 6);
      }),
    );
  });

  it("近づく速さは rate で決まる", () => {
    // 1秒・rate 1 で、残りの 1/e が残る。
    expect(approach(0, 1, 1, 1)).toBeCloseTo(1 - Math.exp(-1), 10);
    expect(approach(2, 5, 1, 1)).toBeCloseTo(5 - 3 * Math.exp(-1), 10);
    expect(approach(0, 1, 0.5, 4)).toBeCloseTo(1 - Math.exp(-2), 10);
  });
});

describe("ADR-0009 §開幕の風 — 奥から手前へ一度だけ渡る", () => {
  it("吹き始める前と渡りきった後は無風", () => {
    expect(openingGust(0)).toEqual({ front: GUST_FROM_Z, strength: 0 });
    expect(openingGust(GUST_DELAY_S)).toEqual({ front: GUST_FROM_Z, strength: 0 });
    expect(openingGust(GUST_DELAY_S + GUST_DURATION_S)).toEqual({
      front: GUST_FROM_Z,
      strength: 0,
    });
    expect(openingGust(60)).toEqual({ front: GUST_FROM_Z, strength: 0 });
  });

  it("波の先頭は奥から手前へ、戻らずに進む", () => {
    let previous = GUST_FROM_Z;
    for (let step = 1; step < 100; step++) {
      const { front } = openingGust(GUST_DELAY_S + (step / 100) * GUST_DURATION_S);
      expect(front).toBeGreaterThan(previous);
      expect(front).toBeLessThan(GUST_TO_Z);
      previous = front;
    }
  });

  it("道のりの半分の時間で、距離の 3/4 まで来ている", () => {
    const { front } = openingGust(GUST_DELAY_S + GUST_DURATION_S / 2);
    expect(front).toBeCloseTo(GUST_FROM_Z + 0.75 * (GUST_TO_Z - GUST_FROM_Z), 10);
  });

  it("先頭は減速しながら来る — 前半のほうが距離を稼ぐ", () => {
    const quarter = GUST_DURATION_S / 4;
    const at = (t: number) => openingGust(GUST_DELAY_S + t).front;
    expect(at(quarter) - at(0.0001)).toBeGreaterThan(at(3 * quarter) - at(2 * quarter));
  });

  it("途中で頂点を迎え、強さは 0〜1 に収まる", () => {
    const strengths = Array.from(
      { length: 99 },
      (_, i) => openingGust(GUST_DELAY_S + ((i + 1) / 100) * GUST_DURATION_S).strength,
    );
    expect(Math.max(...strengths)).toBeCloseTo(1, 2);
    for (const s of strengths) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    expect(strengths[0]).toBeLessThan(0.1);
  });

  it("頂点は道のりの 0.5/1.3、渡りきる前（1/1.3）に止む", () => {
    const at = (progress: number) =>
      openingGust(GUST_DELAY_S + progress * GUST_DURATION_S).strength;
    expect(at(0.5 / 1.3)).toBeCloseTo(1, 10);
    expect(at(0.3)).toBeLessThan(at(0.35));
    expect(at(0.45)).toBeLessThan(at(0.4));
    expect(at(1 / 1.3)).toBeCloseTo(0, 10);
    expect(at(0.9)).toBeCloseTo(0, 10);
  });
});

describe("ADR-0009 §動き — 叩き直しても、波紋は1コマで消えず、1コマで押しきらない", () => {
  const tap = (born: number, x = 0): Ripple => ({ x, z: 0, born, released: null });
  /**
   * `intervals` 秒おきに叩き、上書きした波紋のその時の残り（`left`）を集める。`weakest` は、上書きする前に
   * スロットにあった波紋の残りのうち、いちばん小さいもの。
   */
  const overwritten = (intervals: readonly number[]) => {
    const ripples: Ripple[] = [];
    const lost: { left: number; weakest: number }[] = [];
    let now = 0;
    for (const interval of intervals) {
      now += interval;
      const before = [...ripples];
      addRipple(ripples, tap(now));
      const weakest = Math.min(...before.map((r) => rippleLeft(r, now)));
      for (const r of before)
        if (!ripples.includes(r)) lost.push({ left: rippleLeft(r, now), weakest });
    }
    return { ripples, lost };
  };

  it("スロットが空いているうちは、前の波紋をそのまま残す", () => {
    const first = tap(0);
    const ripples = [first];
    addRipple(ripples, tap(0.1, 1));
    expect(ripples).toHaveLength(2);
    expect(ripples).toContain(first);
    expect(first.released).toBeNull();
  });

  it("スロットは RIPPLE_SLOTS より増えない", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 3, noNaN: true }), { maxLength: 40 }),
        (intervals) => {
          expect(overwritten(intervals).ripples.length).toBeLessThanOrEqual(RIPPLE_SLOTS);
        },
      ),
    );
  });

  it("RIPPLE_RELEASE_S より間を空けて叩く限り、上書きする波紋はもう消えている", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: RIPPLE_RELEASE_S, max: 3, noNaN: true }), { maxLength: 40 }),
        (intervals) => {
          for (const { left } of overwritten(intervals).lost)
            expect(left).toBeLessThan(RIPPLE_GONE);
        },
      ),
    );
  });

  it("もっと速く叩いても、上書きするのはいちばん弱い波紋", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.01, max: RIPPLE_RELEASE_S, noNaN: true }), { maxLength: 40 }),
        (intervals) => {
          for (const { left, weakest } of overwritten(intervals).lost) expect(left).toBe(weakest);
        },
      ),
    );
    // 上書きが起きる速さで、実際に起きていること（上の性質が空振りしていない）。
    expect(
      overwritten(Array.from({ length: 30 }, () => RIPPLE_RELEASE_S / 2)).lost.length,
    ).toBeGreaterThan(0);
  });

  it("埋まったら、手放していない波紋のうち、いちばん古いものを手放す（並び順によらない）", () => {
    // いちばん古い波紋（born 0.1）はもう手放してある。
    for (const order of [
      ["older", "newer", "released"],
      ["newer", "released", "older"],
    ] as const) {
      const ripples = {
        released: { x: 0, z: 0, born: 0.1, released: 0.35 },
        older: tap(0.2),
        newer: tap(0.3),
      } satisfies Record<string, Ripple>;
      const slots = [
        ...order.map((key) => ripples[key]),
        ...Array.from({ length: RIPPLE_SLOTS - 4 }, () => tap(0.3)),
      ];
      const last = tap(0.4);
      addRipple(slots, last);
      expect(ripples.older.released).toBe(0.4);
      expect(ripples.released.released).toBe(0.35); // 手放し直さない（消え方をやり直すと、強さが1コマで上へ跳ぶ）
      expect(ripples.newer.released).toBeNull();
      expect(last.released).toBeNull();
    }
  });

  it("同じコマで叩き直しても、叩いたばかりの波紋は手放さない", () => {
    const ripples = Array.from({ length: RIPPLE_SLOTS }, () => tap(1));
    const last = tap(1);
    addRipple(ripples, last);
    expect(ripples).toContain(last);
    expect(last.released).toBeNull();
    expect(ripples.filter((r) => r.released !== null)).toHaveLength(1);
  });

  it("消えた波紋が残っていれば、埋まっても手放さない", () => {
    const ripples = [tap(0), ...Array.from({ length: RIPPLE_SLOTS - 2 }, () => tap(10))];
    addRipple(ripples, tap(10));
    expect(ripples.every((r) => r.released === null)).toBe(true);
    expect(rippleLeft(ripples[0]!, 10)).toBeLessThan(RIPPLE_GONE);
  });

  it("手放した波紋は RIPPLE_RELEASE_S かけて消える", () => {
    const ripple: Ripple = { x: 0, z: 0, born: 0, released: 1 };
    const kept = tap(0);
    expect(rippleLeft(ripple, 1)).toBeCloseTo(rippleLeft(kept, 1), 10);
    expect(rippleLeft(ripple, 1 + RIPPLE_RELEASE_S / 2)).toBeCloseTo(
      rippleLeft(kept, 1 + RIPPLE_RELEASE_S / 2) / 2,
      10,
    );
    expect(rippleLeft(ripple, 1 + RIPPLE_RELEASE_S)).toBeCloseTo(0, 10);
    expect(rippleLeft(ripple, 5)).toBe(0);
  });

  it("叩いてから RIPPLE_ATTACK_S かけて押しきる — 立ち上がりは 0 から 1 へ、途中で戻らない", () => {
    for (const born of [0, 1.5, 40]) {
      const ripple = tap(born);
      /** 叩いてから `t` 秒後の立ち上がり（強さのうち、残りを除いた分）。 */
      const rise = (t: number) => rippleStrength(ripple, born + t) / rippleLeft(ripple, born + t);
      expect(rise(0)).toBe(0);
      expect(rise(RIPPLE_ATTACK_S / 2)).toBeCloseTo(0.5, 10);
      expect(rise(RIPPLE_ATTACK_S)).toBeCloseTo(1, 10);
      expect(rise(2)).toBeCloseTo(1, 10);
      const steps = Array.from({ length: 20 }, (_, i) => rise((RIPPLE_ATTACK_S * i) / 19));
      for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]!);
    }
  });

  it("消えた波紋（残りが RIPPLE_GONE 未満）の強さは 0 — シェーダーが計算を飛ばせる", () => {
    const ripple = tap(3);
    const gone = 3 + Math.log(1 / RIPPLE_GONE) / RIPPLE_DECAY;
    expect(rippleStrength(ripple, gone - 0.01)).toBeGreaterThan(RIPPLE_GONE * 0.99);
    expect(rippleStrength(ripple, gone + 0.01)).toBe(0);
    expect(rippleStrength({ ...ripple, released: 3.5 }, 3.5 + RIPPLE_RELEASE_S)).toBe(0);
  });

  it("立ち上がりの形（smoothstep）は GLSL と同じ — 端の外は 0 と 1、真ん中で 0.5", () => {
    expect(smoothstep(0.6, 1, 0.5)).toBe(0);
    expect(smoothstep(0.6, 1, 0.7)).toBeCloseTo(0.15625, 10);
    expect(smoothstep(0.6, 1, 0.8)).toBeCloseTo(0.5, 10);
    expect(smoothstep(0.6, 1, 1.2)).toBe(1);
  });

  it("弱まりは RIPPLE_DECAY で決まる", () => {
    expect(rippleLeft(tap(0), 0)).toBe(1);
    expect(rippleLeft(tap(0), 1 / RIPPLE_DECAY)).toBeCloseTo(Math.exp(-1), 10);
  });
});

describe("ADR-0006「追いつかないときは描く解像度を下げる」", () => {
  const frames = (ms: number, count = FRAME_WINDOW) => Array.from({ length: count }, () => ms);

  it("フレームが揃うまでは判断しない", () => {
    expect(isSlow(frames(100, FRAME_WINDOW - 1))).toBe(false);
    expect(isSlow(frames(100))).toBe(true);
  });

  it("中央値が SLOW_FRAME_MS を超えたら重い（ちょうどは重くない）", () => {
    expect(isSlow(frames(SLOW_FRAME_MS))).toBe(false);
    expect(isSlow(frames(SLOW_FRAME_MS + 0.1))).toBe(true);
    expect(isSlow(frames(1000 / 60))).toBe(false);
  });

  it("半分を超えない引っかかりでは下げない", () => {
    const half = FRAME_WINDOW / 2;
    expect(isSlow([...frames(16.7, half + 1), ...frames(200, half - 1)])).toBe(false);
    expect(isSlow([...frames(200, half + 1), ...frames(16.7, half - 1)])).toBe(true);
  });

  it("並び順によらない", () => {
    const intervals = [...frames(16.7, FRAME_WINDOW / 2 - 1), ...frames(40, FRAME_WINDOW / 2 + 1)];
    expect(isSlow(intervals)).toBe(true);
    expect(isSlow([...intervals].reverse())).toBe(true);
  });

  it("真ん中の位置の値ではなく、数の大きさで並べた中央値を見る", () => {
    const half = FRAME_WINDOW / 2;
    // 真ん中の位置にだけ速いフレームがあっても、過半数が重ければ重い。
    expect(isSlow([...frames(40, half), 16.7, ...frames(40, half - 1)])).toBe(true);
    // 文字列として並べると 100 < 25 < 9 になり、中央値が 9 にずれる。
    expect(isSlow([...frames(9, half), 25, ...frames(100, half - 1)])).toBe(true);
  });

  it("渡した配列を並べ替えない", () => {
    const intervals = Array.from({ length: FRAME_WINDOW }, (_, i) => FRAME_WINDOW - i);
    const copy = [...intervals];
    isSlow(intervals);
    expect(intervals).toEqual(copy);
  });

  it("DPR_STEP ずつ下げ、1 で止まる", () => {
    expect(lowerDpr(2)).toBe(2 * DPR_STEP);
    expect(lowerDpr(1.2)).toBe(1);
    expect(lowerDpr(1)).toBeNull();
    expect(lowerDpr(0.75)).toBeNull();
  });

  it("下げ続けると、どこから始めても有限回で 1 に着く", () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 4, noNaN: true }), (start) => {
        let dpr: number | null = start;
        let last = start;
        for (let i = 0; i < 10 && dpr !== null; i++) {
          expect(dpr).toBeLessThanOrEqual(last);
          expect(dpr).toBeGreaterThanOrEqual(1);
          last = dpr;
          dpr = lowerDpr(dpr);
        }
        expect(dpr).toBeNull();
        expect(last).toBe(1);
      }),
    );
  });
});

/**
 * 株のファイル。形式の正本は scripts/generate-field-assets.mjs。
 * 形が合わないファイルを読むと GPU が範囲外を読みに行くので、1つでも合わなければ null で、
 * 呼び出し側は元の描き方（一枚絵の花）に戻る。
 */
describe("ADR-0009 §花の3Dモデル — 株のファイルを確かめて読む", () => {
  interface Part {
    firstIndex: number;
    indexCount: number;
    heightCm: number;
  }

  /** 形式どおりのファイルを組み立てる。`tweak` で1か所だけ壊す。 */
  const build = (
    options: {
      magic?: number;
      version?: number;
      vertexCount?: number;
      indices?: number[];
      parts?: Part[];
      scale?: number;
      extraBytes?: number;
    } = {},
  ): ArrayBuffer => {
    const indices = options.indices ?? [0, 1, 2, 2, 1, 3];
    const vertexCount = options.vertexCount ?? 4;
    const parts = options.parts ?? [{ firstIndex: 0, indexCount: indices.length, heightCm: 20 }];
    const align4 = (n: number) => (n + 3) & ~3;
    const header = 24 + parts.length * 12;
    const size =
      header +
      align4(vertexCount * 6) +
      align4(vertexCount * 3) +
      vertexCount * 4 +
      align4(indices.length * 2) +
      (options.extraBytes ?? 0);
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);
    view.setUint32(0, options.magic ?? 0x4f4d454e, true);
    view.setUint32(4, options.version ?? 1, true);
    view.setUint32(8, parts.length, true);
    view.setUint32(12, vertexCount, true);
    view.setUint32(16, indices.length, true);
    view.setFloat32(20, options.scale ?? 23.5, true);
    parts.forEach((p, i) => {
      view.setUint32(24 + i * 12, p.firstIndex, true);
      view.setUint32(28 + i * 12, p.indexCount, true);
      view.setFloat32(32 + i * 12, p.heightCm, true);
    });
    const indicesAt = header + align4(vertexCount * 6) + align4(vertexCount * 3) + vertexCount * 4;
    indices.forEach((index, i) => view.setUint16(indicesAt + i * 2, index, true));
    return buffer;
  };

  it("形式どおりなら読める", () => {
    const mesh = parseFieldMesh(build());
    expect(mesh).not.toBeNull();
    expect(mesh!.vertexCount).toBe(4);
    expect(mesh!.positionScale).toBeCloseTo(23.5, 5);
    expect(mesh!.parts).toEqual([{ firstIndex: 0, indexCount: 6, heightCm: 20 }]);
    expect(mesh!.positions).toHaveLength(12);
    expect(mesh!.normals).toHaveLength(12);
    expect(mesh!.uvs).toHaveLength(8);
    expect([...mesh!.indices]).toEqual([0, 1, 2, 2, 1, 3]);
  });

  it("株を複数持てる", () => {
    const parts = [
      { firstIndex: 0, indexCount: 3, heightCm: 20 },
      { firstIndex: 3, indexCount: 3, heightCm: 21 },
    ];
    expect(parseFieldMesh(build({ parts }))?.parts).toEqual(parts);
  });

  it("株ごとの三角形の数を、その株の表から読む", () => {
    const parts = [
      { firstIndex: 0, indexCount: 3, heightCm: 20 },
      { firstIndex: 3, indexCount: 6, heightCm: 21 },
    ];
    expect(parseFieldMesh(build({ parts, indices: [0, 1, 2, 2, 1, 3, 0, 2, 3] }))?.parts).toEqual(
      parts,
    );
  });

  it.each([
    ["空", () => new ArrayBuffer(0)],
    ["見出しの途中で切れている", () => build().slice(0, 23)],
    ["先頭が NEMO でない", () => build({ magic: 0x4f4d454f })],
    ["形式のバージョンが違う", () => build({ version: 2 })],
    ["途中で切れている", () => build().slice(0, -4)],
    ["後ろに余計なものがある", () => build({ extraBytes: 4 })],
    [
      "頂点が無い",
      () =>
        build({
          vertexCount: 0,
          indices: [],
          parts: [{ firstIndex: 0, indexCount: 3, heightCm: 20 }],
        }),
    ],
    [
      "三角形の数が整数でない",
      () =>
        build({ indices: [0, 1, 2, 3], parts: [{ firstIndex: 0, indexCount: 4, heightCm: 20 }] }),
    ],
    ["頂点の番号が範囲外", () => build({ indices: [0, 1, 4] })],
    ["位置の倍率が 0", () => build({ scale: 0 })],
    ["位置の倍率が NaN", () => build({ scale: Number.NaN })],
    [
      "株に隙間がある",
      () =>
        build({
          parts: [{ firstIndex: 3, indexCount: 3, heightCm: 20 }],
          indices: [0, 1, 2, 2, 1, 3],
        }),
    ],
    [
      "株の合計が三角形の数と合わない",
      () =>
        build({
          parts: [{ firstIndex: 0, indexCount: 3, heightCm: 20 }],
          indices: [0, 1, 2, 2, 1, 3],
        }),
    ],
    [
      "株が空",
      () =>
        build({
          parts: [
            { firstIndex: 0, indexCount: 0, heightCm: 20 },
            { firstIndex: 0, indexCount: 6, heightCm: 20 },
          ],
        }),
    ],
    [
      "株の三角形の数が整数でない",
      () =>
        build({
          parts: [
            { firstIndex: 0, indexCount: 4, heightCm: 20 },
            { firstIndex: 4, indexCount: 2, heightCm: 20 },
          ],
        }),
    ],
    ["株の高さが 0", () => build({ parts: [{ firstIndex: 0, indexCount: 6, heightCm: 0 }] })],
    [
      "株が重なっている（合計は合う）",
      () =>
        build({
          parts: [
            { firstIndex: 0, indexCount: 3, heightCm: 20 },
            { firstIndex: 0, indexCount: 3, heightCm: 20 },
          ],
        }),
    ],
    ["株が無い", () => build({ parts: [], indices: [], vertexCount: 0 })],
  ])("%s → null", (_, make) => {
    expect(parseFieldMesh(make())).toBeNull();
  });
});

describe("ADR-0009 — 素材は独自バンドルのみ配る", () => {
  it("public/field/ に単独の素材を置かない", () => {
    const dir = fileURLToPath(new URL("../../public/field/", import.meta.url));
    // OS が置くファイルでは落とさない。リンクは、先がファイルでもフォルダでも配られるので数える。
    const files = existsSync(dir)
      ? readdirSync(dir, { recursive: true, withFileTypes: true })
          .filter(
            (e) => !e.isDirectory() && !/^(Thumbs\.db|desktop\.ini|\.DS_Store)$/i.test(e.name),
          )
          .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
      : [];
    // 素材は非公開のリポジトリから重ねるので、重ねていなければ空（RRNNM-44）。
    expect([[], ["NOTICE.txt", "nemophila.bin"]]).toContainEqual(files.sort());
  });
});

describe("ADR-0009 §映る幅に植える — 縦横比が変わっても密度は基準と揃う", () => {
  /*
   * レンダラーと同じ形の畑。手前（z > clumpFarZ）は株の外側にだけ、奥は映る幅いっぱいに植える。
   * 値はレンダラーから写していない — ここで見たいのは形に対する性質で、値には依らない。
   */
  const NEAR_Z = 7;
  const FAR_Z = -82;
  const baseHalf = (z: number) => 5 + (8 - z) * 0.78;
  const visible = (z: number, reach: number) => (8 - z) * reach + 1.5;
  const bedFor = (reach: number, clumpFarZ: number): FlowerBed => {
    const clumpHalf = (z: number) => Math.min(baseHalf(z), visible(z, reach / 1.1));
    return {
      nearZ: NEAR_Z,
      farZ: FAR_Z,
      width: (z) =>
        z > clumpFarZ ? Math.max(0, visible(z, reach) - clumpHalf(z)) : visible(z, reach),
      outer: (z) => visible(z, reach),
      baseHalf,
      breaks: [clumpFarZ],
    };
  };
  /** シードを固定した乱数（mulberry32）。 */
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** 帯 [z0, z1] で share（width / baseHalf）を積分したもの。 */
  const integral = (bed: FlowerBed, z0: number, z1: number) => {
    const n = 2000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const z = z0 + ((i + 0.5) / n) * (z1 - z0);
      sum += bed.width(z) / bed.baseHalf(z);
    }
    return (sum / n) * (z1 - z0);
  };

  // 縦長（画角 64°）・16:9・横に広い（2560×720）。reach には余白の 1.1 を掛けてある。
  const SCREENS = [
    ["縦長 400×720", Math.tan((64 * Math.PI) / 360) * (400 / 720) * 1.1],
    ["16:9", Math.tan((50 * Math.PI) / 360) * (16 / 9) * 1.1],
    ["2560×720", Math.tan((50 * Math.PI) / 360) * (2560 / 720) * 1.1],
  ] as const;

  it.each(SCREENS)("%s: 上限に届かなければ、本数は基準の密度で植えたときの数", (_, reach) => {
    for (const clumpFarZ of [NEAR_Z, -12]) {
      const bed = bedFor(reach, clumpFarZ);
      const perDepth = 300;
      const wanted = perDepth * integral(bed, FAR_Z, NEAR_Z);
      expect(planFlowers(bed, perDepth, Infinity).count / wanted).toBeCloseTo(1, 2);
      expect(planFlowers(bed, perDepth, 1000).count).toBe(
        Math.min(1000, planFlowers(bed, perDepth, Infinity).count),
      );
    }
  });

  it.each(SCREENS)(
    "%s: 奥行きの帯ごとの本数が、帯の広さ（基準の幅に対する割合）に比例する",
    (_, reach) => {
      const bed = bedFor(reach, -12);
      const plan = planFlowers(bed, 300, Infinity);
      const random = seeded(1);
      const spot = { x: 0, z: 0 };
      const BANDS = 8;
      const depth = NEAR_Z - FAR_Z;
      const counts = Array.from({ length: BANDS }, () => 0);
      for (let i = 0; i < plan.count;) {
        if (!placeFlower(bed, plan, random, spot)) continue;
        const half = Math.abs(spot.x);
        // 植える範囲 [outer - width, outer] の中に落ちる。
        expect(half).toBeLessThanOrEqual(bed.outer(spot.z) + 1e-9);
        expect(half).toBeGreaterThanOrEqual(bed.outer(spot.z) - bed.width(spot.z) - 1e-9);
        counts[Math.min(BANDS - 1, Math.floor(((NEAR_Z - spot.z) / depth) * BANDS))]! += 1;
        i++;
      }
      const total = integral(bed, FAR_Z, NEAR_Z);
      counts.forEach((count, b) => {
        const z1 = NEAR_Z - (b / BANDS) * depth;
        const z0 = NEAR_Z - ((b + 1) / BANDS) * depth;
        const expected = (plan.count * integral(bed, z0, z1)) / total;
        expect(Math.abs(count - expected)).toBeLessThan(Math.max(30, expected * 0.05));
      });
    },
  );

  it("受け入れる率の上限は、どの奥行きの割合も下回らない（下回るとその帯だけまばらになる）", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 4, noNaN: true }),
        fc.double({ min: FAR_Z, max: NEAR_Z, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (reach, clumpFarZ, at) => {
          const bed = bedFor(reach, clumpFarZ);
          const z = NEAR_Z - at * (NEAR_Z - FAR_Z);
          // 割合がほぼ平らなとき（reach ≈ 0.234）は、計算の丸めで最後の桁がずれる。
          expect(planFlowers(bed, 300, Infinity).peak).toBeGreaterThanOrEqual(
            bed.width(z) / bed.baseHalf(z) - 1e-12,
          );
        },
      ),
    );
  });

  it("狭い画面では、割合の最大は株の帯の奥の端に来る（そこでも測る）", () => {
    // reach が小さいと、映る幅 / 基準の幅 は奥ほど小さい。株の帯の外では、株の奥の端が一番広い。
    const bed = bedFor(0.1, -12);
    const plan = planFlowers(bed, 300, Infinity);
    expect(plan.peak).toBe(bed.width(-12) / bed.baseHalf(-12));
    expect(plan.peak).toBeGreaterThan(bed.width(FAR_Z) / bed.baseHalf(FAR_Z));
  });

  it("畑の外の切り替わりは、上限の計算に入れない", () => {
    // 手前の帯だけを植える畑。株の奥の端（-12）はこの畑の外。
    const whole = bedFor(2, -12);
    const near: FlowerBed = { ...whole, farZ: -6 };
    expect(planFlowers(near, 300, Infinity).peak).toBe(
      Math.max(near.width(NEAR_Z) / baseHalf(NEAR_Z), near.width(-6) / baseHalf(-6)),
    );
    // 入れていたら、上限は畑の外の（もっと広い）割合になる。
    expect(near.width(-12) / baseHalf(-12)).toBeGreaterThan(planFlowers(near, 300, Infinity).peak);
  });

  it("植える幅が 0 の帯には植えない", () => {
    // 手前半分は幅 0。
    const bed: FlowerBed = {
      nearZ: 0,
      farZ: -10,
      width: (z) => (z > -5 ? 0 : 3),
      outer: () => 3,
      baseHalf: () => 3,
    };
    const plan = planFlowers(bed, 10, Infinity);
    expect(plan.count).toBe(50);
    const random = seeded(2);
    const spot = { x: 0, z: 0 };
    for (let i = 0; i < 500; i++)
      if (placeFlower(bed, plan, random, spot)) expect(spot.z).toBeLessThanOrEqual(-5);
  });

  it("植える幅が 0 の帯には、乱数が 0 を返しても植えない", () => {
    const bed: FlowerBed = {
      nearZ: 0,
      farZ: -10,
      width: (z) => (z > -5 ? 0 : 3),
      outer: () => 3,
      baseHalf: () => 3,
    };
    // 乱数がずっと 0 なら、いちばん手前（幅 0）の帯を試す。
    expect(placeFlower(bed, planFlowers(bed, 10, Infinity), () => 0, { x: 0, z: 0 })).toBe(false);
  });

  it("畑より手前にある切り替わりも、上限の計算に入れない", () => {
    // 手前の端（z = 0）の外だけ、割合が 2 に上がる。
    const bed: FlowerBed = {
      nearZ: 0,
      farZ: -10,
      width: (z) => (z > 0 ? 6 : 3),
      outer: () => 6,
      baseHalf: () => 3,
      breaks: [1],
    };
    expect(planFlowers(bed, 10, Infinity).peak).toBe(1);
  });

  it("左右の両側に、ほぼ半々に植える", () => {
    const bed = bedFor(1, -12);
    const plan = planFlowers(bed, 300, Infinity);
    const random = seeded(3);
    const spot = { x: 0, z: 0 };
    let left = 0;
    let placed = 0;
    while (placed < 2000) {
      if (!placeFlower(bed, plan, random, spot)) continue;
      placed++;
      if (spot.x < 0) left++;
    }
    expect(left / placed).toBeGreaterThan(0.45);
    expect(left / placed).toBeLessThan(0.55);
  });
});

describe("ADR-0009 §映る幅に張る — 地面の刻み", () => {
  it("頂点の数が Uint16 のインデックスに収まり、収まる限りは刻みが step 以下", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e5, noNaN: true }),
        fc.double({ min: 0.5, max: 10, noNaN: true }),
        fc.integer({ min: 1, max: 200 }),
        (span, step, rows) => {
          const columns = groundColumns(span, step, rows);
          expect(columns).toBeGreaterThanOrEqual(1);
          expect((columns + 1) * (rows + 1)).toBeLessThanOrEqual(MAX_GROUND_VERTICES);
          if ((Math.ceil(span / step) + 1) * (rows + 1) <= MAX_GROUND_VERTICES) {
            expect(span / columns).toBeLessThanOrEqual(step + 1e-9);
          }
        },
      ),
    );
  });

  it("刻みの数は GROUND_COLUMN_UNIT の倍数に切り上げる（少し広がっても数が変わらない）", () => {
    expect(groundColumns(1, 2, 70)).toBe(GROUND_COLUMN_UNIT);
    expect(groundColumns(2 * GROUND_COLUMN_UNIT, 2, 70)).toBe(GROUND_COLUMN_UNIT);
    expect(groundColumns(2 * GROUND_COLUMN_UNIT + 0.1, 2, 70)).toBe(2 * GROUND_COLUMN_UNIT);
  });

  it("上限は、頂点の数がちょうど収まるところ", () => {
    expect(groundColumns(1e9, 1, 70)).toBe(Math.floor(MAX_GROUND_VERTICES / 71) - 1);
  });
});
