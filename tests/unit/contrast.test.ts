import fc from 'fast-check';
import { describe, expect, it } from 'vite-plus/test';

import {
  AA_LARGE,
  AA_NORMAL,
  contrastRatio,
  meetsAA,
  parseHex,
  relativeLuminance,
} from '../../src/lib/contrast';

/**
 * docs/DESIGN.md §4 の表をそのまま持ってきたもの。
 * 数値は設計時に実測してドキュメントへ書き込んだ値であり、ここが仕様。
 * パレットを変えるときは、この表を先に直す。
 */
const lightRatios = [
  { use: '本文', fg: '#1B2A6B', bg: '#FFFFFF', ratio: 13.21 },
  { use: '本文（青い地）', fg: '#1B2A6B', bg: '#A2C7F3', ratio: 7.55 },
  { use: '補助文（白地）', fg: '#5A6286', bg: '#FFFFFF', ratio: 5.96 },
  { use: '青い地に補助文', fg: '#5A6286', bg: '#A2C7F3', ratio: 3.4 },
  { use: 'リンク（白地）', fg: '#2A51A3', bg: '#FFFFFF', ratio: 7.49 },
  { use: '青い地にロゴの青', fg: '#2A51A3', bg: '#A2C7F3', ratio: 4.28 },
  { use: '帯の青に白', fg: '#FFFFFF', bg: '#2658AF', ratio: 6.78 },
  { use: '青い地に白', fg: '#FFFFFF', bg: '#A2C7F3', ratio: 1.75 },
  { use: 'ラベンダーに本文', fg: '#1B2A6B', bg: '#E7D7FE', ratio: 9.78 },
  { use: 'リボンの紫（装飾専用）', fg: '#988CDE', bg: '#FFFFFF', ratio: 2.94 },
  { use: '蝶のピンク（装飾専用）', fg: '#E25B82', bg: '#FFFFFF', ratio: 3.47 },
  { use: '黄（面と縁飾り専用）', fg: '#FAC05B', bg: '#FFFFFF', ratio: 1.65 },
] as const;

const darkRatios = [
  { use: '本文', fg: '#EDE8F2', bg: '#14142B', ratio: 14.96 },
  { use: 'ピンク', fg: '#F79BB6', bg: '#14142B', ratio: 8.86 },
  { use: '淡青', fg: '#A9C4EE', bg: '#14142B', ratio: 10.15 },
] as const;

describe('docs/DESIGN.md §4 — パレットのコントラスト実測値', () => {
  // it.each ではなく素のループで回す。テスト名を doc の表の1行そのものにしたいので、
  // ランナー側の値の整形（引用符が付く等）を挟ませない。
  for (const { use, fg, bg, ratio } of lightRatios) {
    it(`ライト: ${use} — ${fg} on ${bg} は ${ratio}`, () => {
      expect(contrastRatio(fg, bg)).toBeCloseTo(ratio, 2);
    });
  }

  for (const { use, fg, bg, ratio } of darkRatios) {
    it(`ダーク: ${use} — ${fg} on ${bg} は ${ratio}`, () => {
      expect(contrastRatio(fg, bg)).toBeCloseTo(ratio, 2);
    });
  }
});

describe('docs/DESIGN.md §4 — 配色ルールの判定', () => {
  it('本文 #1B2A6B は白地でも青い地でも AA を満たす', () => {
    expect(meetsAA(contrastRatio('#1B2A6B', '#FFFFFF'))).toBe(true);
    expect(meetsAA(contrastRatio('#1B2A6B', '#A2C7F3'))).toBe(true);
  });

  it('蝶のピンク #E25B82 は白地では大字のみ可 — 文字にはしない', () => {
    const ratio = contrastRatio('#E25B82', '#FFFFFF');
    expect(meetsAA(ratio, 'large')).toBe(true);
    expect(meetsAA(ratio, 'normal')).toBe(false);
  });

  it('黄 #FAC05B は大字でも AA を満たさない — 文字色にしない', () => {
    const ratio = contrastRatio('#FAC05B', '#FFFFFF');
    expect(meetsAA(ratio, 'large')).toBe(false);
    expect(meetsAA(ratio, 'normal')).toBe(false);
  });

  it('地が変わったら色も変える — ロゴの青 #2A51A3 は白地では AA、青い地 #A2C7F3 では不可', () => {
    expect(meetsAA(contrastRatio('#2A51A3', '#FFFFFF'))).toBe(true);
    expect(meetsAA(contrastRatio('#2A51A3', '#A2C7F3'))).toBe(false);
    // 帯の青に逃げても届かない（3.87）。
    expect(meetsAA(contrastRatio('#2658AF', '#A2C7F3'))).toBe(false);
    // 青い地には本文色を使う、が結論。
    expect(meetsAA(contrastRatio('#1B2A6B', '#A2C7F3'))).toBe(true);
  });

  it('リボンの紫 #988CDE は白も本文色も載せられない — 装飾にしか使わない', () => {
    expect(meetsAA(contrastRatio('#FFFFFF', '#988CDE'), 'large')).toBe(false);
    // 本文色は 4.49 で、わずかに届かない。
    expect(meetsAA(contrastRatio('#1B2A6B', '#988CDE'))).toBe(false);
  });

  // docs/DESIGN.md §4 は「ライトの #E25B82 をそのまま持ってくると読めない」と書いているが、
  // 実測すると 5.20 で AA は満たしている。満たさないのは「白地の小さい文字」のほう（3.47）。
  // ここでは実測に合わせ、ダークで明度を上げる根拠は「AA 不足」ではなく
  // 「ライトと同じ見え方にならない」ことだと書き下す。→ docs 側の文言は要修正。
  it('ダークではピンクの明度を上げる — #E25B82 は 5.20、#F79BB6 は 8.86', () => {
    expect(contrastRatio('#E25B82', '#14142B')).toBeCloseTo(5.2, 2);
    expect(contrastRatio('#F79BB6', '#14142B')).toBeCloseTo(8.86, 2);
    // ライト（白地 3.47）とダークで見え方を揃えるなら、明度を上げないと釣り合わない。
    expect(contrastRatio('#F79BB6', '#14142B')).toBeGreaterThan(
      contrastRatio('#E25B82', '#14142B'),
    );
  });
});

describe('meetsAA の境界', () => {
  it('比がちょうど 4.5 は通常サイズで AA', () => {
    expect(meetsAA(AA_NORMAL)).toBe(true);
    expect(meetsAA(AA_NORMAL - 0.01)).toBe(false);
  });

  it('比がちょうど 3 は大字で AA', () => {
    expect(meetsAA(AA_LARGE, 'large')).toBe(true);
    expect(meetsAA(AA_LARGE - 0.01, 'large')).toBe(false);
  });

  it('サイズを省略したら通常サイズとして扱う', () => {
    expect(meetsAA(AA_LARGE)).toBe(false);
    expect(meetsAA(AA_LARGE, 'large')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 性質ベース（property-based）。
// 個別の値ではなく「どんな色に対しても成り立つこと」を書く。
// 上の表は仕様の転記、こちらは実装が壊れていないことの担保。役割が違う。
// ---------------------------------------------------------------------------

const anyColor = fc
  .integer({ min: 0x000000, max: 0xffffff })
  .map((n) => `#${n.toString(16).padStart(6, '0').toUpperCase()}`);

describe('コントラスト比の性質', () => {
  it('前景と背景を入れ替えても比は変わらない', () => {
    fc.assert(
      fc.property(anyColor, anyColor, (a, b) => {
        expect(contrastRatio(a, b)).toBe(contrastRatio(b, a));
      }),
    );
  });

  it('比は必ず 1 以上 21 以下', () => {
    fc.assert(
      fc.property(anyColor, anyColor, (a, b) => {
        const ratio = contrastRatio(a, b);
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(21);
      }),
    );
  });

  it('同じ色どうしの比は 1', () => {
    fc.assert(
      fc.property(anyColor, (c) => {
        expect(contrastRatio(c, c)).toBeCloseTo(1, 12);
      }),
    );
  });

  it('黒と白の比は 21', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 10);
  });

  it('白に対する比は、相対輝度が高い色ほど小さい', () => {
    fc.assert(
      fc.property(anyColor, anyColor, (a, b) => {
        const [darker, lighter] =
          relativeLuminance(parseHex(a)) <= relativeLuminance(parseHex(b)) ? [a, b] : [b, a];
        expect(contrastRatio(darker, '#FFFFFF')).toBeGreaterThanOrEqual(
          contrastRatio(lighter, '#FFFFFF'),
        );
      }),
    );
  });
});

describe('相対輝度の性質', () => {
  it('必ず 0 以上 1 以下', () => {
    fc.assert(
      fc.property(anyColor, (c) => {
        const l = relativeLuminance(parseHex(c));
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('黒が 0、白が 1', () => {
    expect(relativeLuminance(parseHex('#000000'))).toBe(0);
    expect(relativeLuminance(parseHex('#FFFFFF'))).toBeCloseTo(1, 12);
  });

  // WCAG の線形化は暗い側と明るい側で式が変わる。境界はチャンネル 10.0164 相当なので、
  // 10 と 11 で別の式に入る。ダークモードの地（#14142B）の周辺で効く分岐であり、
  // ここを外すと暗い色どうしの比だけが静かにずれる。
  it('チャンネル 10 以下は線形区間、11 以上はガンマ区間', () => {
    expect(relativeLuminance({ r: 10, g: 10, b: 10 })).toBeCloseTo(10 / 255 / 12.92, 12);
    expect(relativeLuminance({ r: 11, g: 11, b: 11 })).toBeCloseTo(
      ((11 / 255 + 0.055) / 1.055) ** 2.4,
      12,
    );
  });

  it('どのチャンネルを上げても輝度は下がらない', () => {
    fc.assert(
      fc.property(
        fc.record({
          r: fc.integer({ min: 0, max: 254 }),
          g: fc.integer({ min: 0, max: 254 }),
          b: fc.integer({ min: 0, max: 254 }),
        }),
        fc.constantFrom<'r' | 'g' | 'b'>('r', 'g', 'b'),
        (color, ch) => {
          const raised = { ...color, [ch]: color[ch] + 1 };
          expect(relativeLuminance(raised)).toBeGreaterThan(relativeLuminance(color));
        },
      ),
    );
  });
});

describe('parseHex の性質', () => {
  it('#RRGGBB を受け付け、各チャンネルは 0–255 の整数になる', () => {
    fc.assert(
      fc.property(anyColor, (c) => {
        const { r, g, b } = parseHex(c);
        for (const v of [r, g, b]) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
        }
      }),
    );
  });

  it('16進の桁がそのままチャンネルになる', () => {
    expect(parseHex('#123456')).toEqual({ r: 0x12, g: 0x34, b: 0x56 });
    expect(parseHex('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  const rejectedInputs = [
    { input: '#FFF', why: '3桁記法' },
    { input: 'FFFFFF', why: '# が無い' },
    { input: '#GGGGGG', why: '16進ではない' },
    { input: '#FFFFFFF', why: '後ろに余分な桁がある' },
    { input: 'x#FFFFFF', why: '前に余分な文字がある' },
    { input: ' #FFFFFF', why: '前に空白がある' },
    { input: 'rgb(0,0,0)', why: '関数記法' },
    { input: '', why: '空文字' },
  ] as const;

  for (const { input, why } of rejectedInputs) {
    it(`${JSON.stringify(input)} は受け付けない（${why}）`, () => {
      expect(() => parseHex(input)).toThrow(TypeError);
      // 受け付ける形をエラー文が示していること。何を直せばいいかが分かる必要がある。
      expect(() => parseHex(input)).toThrow(/#RRGGBB/);
    });
  }
});

describe('meetsAA の性質', () => {
  it('AA を満たす比より大きい比は必ず AA を満たす', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 21, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.constantFrom<'normal' | 'large'>('normal', 'large'),
        (ratio, extra, size) => {
          fc.pre(meetsAA(ratio, size));
          expect(meetsAA(ratio + extra, size)).toBe(true);
        },
      ),
    );
  });

  it('通常サイズで AA なら大字でも必ず AA', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 21, noNaN: true }), (ratio) => {
        fc.pre(meetsAA(ratio, 'normal'));
        expect(meetsAA(ratio, 'large')).toBe(true);
      }),
    );
  });
});
