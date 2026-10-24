import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vite-plus/test';

import {
  charIndex,
  CHEERS,
  deadlineOf,
  DEFAULT_UNTIL,
  landing,
  MISSES,
  nextStop,
  parseMuted,
  pick,
  REACTIONS,
  slideDuration,
  SOUND_LEVEL,
  slidePosition,
  stripPosition,
  voiceFor,
  WORD,
} from '../../src/lib/kusobaka-slot';

/**
 * src/lib/kusobaka-slot.ts — クソバカスロット（src/pages/kusobaka-slot.astro）の、DOM と音に触らないところ。
 * 壊れると「期限までにクソバカ以外で止まる」「止めた瞬間に帯が跳ぶ」「延ばしたのに期限切れになる」の形で出る。
 */

const SOUNDS = fileURLToPath(new URL('../../src/assets/kusobaka-slot/', import.meta.url));

const mod4 = (n: number) => ((n % 4) + 4) % 4;

describe('当たりの字', () => {
  it('4本のリールの当たりは、左からク・ソ・バ・カ', () => {
    expect(WORD.join('')).toBe('クソバカ');
  });
});

describe('鳴らすセリフ', () => {
  const files = existsSync(SOUNDS) ? readdirSync(SOUNDS).filter((name) => name.endsWith('.mp3')) : [];

  it('そろうまでとそろったときのセリフは4つずつ、そろわなかったときのセリフは3つで、重ならない', () => {
    expect(REACTIONS).toHaveLength(4);
    expect(CHEERS).toHaveLength(4);
    expect(MISSES).toHaveLength(3);
    expect(new Set([...REACTIONS, ...CHEERS, ...MISSES]).size).toBe(11);
  });

  it('重ねた src/assets/kusobaka-slot/ の mp3 は、セリフと停止音・成功音に1本ずつで、欠けも余りも無い', () => {
    const all = [...REACTIONS, ...CHEERS, ...MISSES, 'stop', 'success'].map((name) => `${name}.mp3`).sort();
    // 音は非公開のリポジトリから重ねるので、重ねていなければ空（ADR-0029 の決定）。
    expect([[], all]).toContainEqual(files.sort());
  });

  it('1〜3本めを止めたときは、そろうまでのセリフ', () => {
    for (const stopped of [1, 2, 3]) {
      expect(voiceFor(stopped, () => 0)).toBe(REACTIONS[0]);
      expect(voiceFor(stopped, () => 0.999)).toBe(REACTIONS[3]);
    }
  });

  it('4本めを止めてそろったときは、そろったときのセリフ', () => {
    expect(voiceFor(4, () => 0)).toBe(CHEERS[0]);
    expect(voiceFor(4, () => 0.999)).toBe(CHEERS[3]);
  });
});

describe('pick', () => {
  it('乱数の値に応じて、どの要素も選ばれうる', () => {
    const items = ['a', 'b', 'c', 'd'];
    expect(pick(items, () => 0)).toBe('a');
    expect(pick(items, () => 0.25)).toBe('b');
    expect(pick(items, () => 0.5)).toBe('c');
    expect(pick(items, () => 0.999)).toBe('d');
  });
});

describe('stripPosition — 帯を3回重ねたまん中の回に入れる', () => {
  it('まん中の回の中の位置はそのまま', () => {
    expect(stripPosition(4)).toBe(4);
    expect(stripPosition(5.5)).toBe(5.5);
    expect(stripPosition(7.75)).toBe(7.75);
  });

  it('4の倍数ずれた位置は、まん中の回の同じ位置になる', () => {
    expect(stripPosition(0)).toBe(4);
    expect(stripPosition(8)).toBe(4);
    expect(stripPosition(3.25)).toBe(7.25);
    expect(stripPosition(13.5)).toBe(5.5);
  });

  it('負の位置も、まん中の回に入れる', () => {
    expect(stripPosition(-0.5)).toBe(7.5);
    expect(stripPosition(-4)).toBe(4);
    expect(stripPosition(-9)).toBe(7);
  });
});

describe('landing — 止めたあとに行き着く位置', () => {
  it('位置が減る向きに回るので、今の位置より手前の、狙った字の位置に行き着く', () => {
    expect(landing(6.75, 0, 0.25)).toBe(4);
    expect(landing(6.75, 1, 0.25)).toBe(5);
    expect(landing(6.75, 2, 0.25)).toBe(6);
    expect(landing(6.75, 3, 0.25)).toBe(3);
  });

  it('ちょうど minSlide だけ滑れば狙った字に届くなら、そこで止まる', () => {
    expect(landing(4.25, 0, 0.25)).toBe(4);
  });

  it('minSlide より手前で狙った字が過ぎるなら、次に来たところまで滑る', () => {
    expect(landing(4.125, 0, 0.25)).toBe(0);
  });

  it('負の位置でも、狙った字の位置に行き着く', () => {
    expect(landing(-2.5, 2, 0.25)).toBe(-6);
  });

  // この位置は、丸めないと小数の引き算の誤差で -1.0000000000000002 になる。
  it('小数の引き算の誤差が出る位置でも、ちょうど字のまん中（整数）に行き着く', () => {
    expect(landing(2.107281304653341, 3, 0.3)).toBe(-1);
  });

  it('行き着く位置は整数で、狙った字と4を法として合同で、minSlide 以上滑った先の最初のところ', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.integer({ min: 0, max: 3 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (position, target, minSlide) => {
          const to = landing(position, target, minSlide);
          const slid = position - to;
          expect(Number.isInteger(to)).toBe(true);
          expect(mod4(to - target)).toBe(0);
          // 丸めの分の誤差だけ許す。
          expect(slid).toBeGreaterThanOrEqual(minSlide - 1e-9);
          expect(slid).toBeLessThan(minSlide + 4 + 1e-9);
        },
      ),
    );
  });
});

describe('slideDuration・slidePosition — 止めてから滑る動き', () => {
  it('滑る時間は、回っていた速さのまま一定の割合で減速して止まる長さ', () => {
    expect(slideDuration(3, 0.5)).toBe(12);
    expect(slideDuration(1, 0.25)).toBe(8);
  });

  it('始めは from、時間が来たら to にいて、途中は減速しながら進む', () => {
    expect(slidePosition(10, 6, 0, 100)).toBe(10);
    expect(slidePosition(10, 6, 25, 100)).toBe(8.25);
    expect(slidePosition(10, 6, 50, 100)).toBe(7);
    expect(slidePosition(10, 6, 100, 100)).toBe(6);
  });

  // 描くフレームの時刻は、押した時刻より前のことがある（requestAnimationFrame はフレームの頭の時刻を渡す）。
  it('時間の前後に外れても、from と to の外へ出ない', () => {
    expect(slidePosition(10, 6, -10, 100)).toBe(10);
    expect(slidePosition(10, 6, 150, 100)).toBe(6);
  });

  it('滑る時間が 0（目押しで字のちょうどまん中で押した）なら、時間に関わらず to にいる', () => {
    expect(slidePosition(5, 5, 0, 0)).toBe(5);
    expect(slidePosition(5, 5, -3, 0)).toBe(5);
    expect(slidePosition(5, 5, 3, 0)).toBe(5);
  });

  // 止めた瞬間に帯の速さが変わると、跳んだように見える。
  it('滑り始めの速さは、回っていた速さと同じ', () => {
    const speed = 0.5;
    const duration = slideDuration(3, speed);
    const step = 0.001;
    expect((slidePosition(10, 7, 0, duration) - slidePosition(10, 7, step, duration)) / step).toBeCloseTo(speed, 3);
  });
});

describe('nextStop・charIndex — 期限を過ぎたあとの目押し', () => {
  it('押したときに次にまん中へ来る字で止まる（位置が減る向きに回るので、切り捨て）', () => {
    expect(nextStop(5.9)).toBe(5);
    expect(nextStop(5.1)).toBe(5);
    expect(nextStop(-0.25)).toBe(-1);
  });

  it('字のちょうどまん中で押したら、その字で止まる', () => {
    expect(nextStop(6)).toBe(6);
  });

  it('まん中の字は、いちばん近いコマの字', () => {
    expect([4, 5, 6, 7].map(charIndex)).toEqual([0, 1, 2, 3]);
    expect(charIndex(5.4)).toBe(1);
    expect(charIndex(5.6)).toBe(2);
    expect(charIndex(-1)).toBe(3);
    expect(charIndex(-4.2)).toBe(0);
  });
});

describe('deadlineOf — 期限の日付から、その日が終わる時刻（日本時間）', () => {
  it('元ネタの日は、日本時間の 2026-10-19 0:00 に終わる', () => {
    expect(deadlineOf(DEFAULT_UNTIL)).toBe(Date.parse('2026-10-19T00:00:00+09:00'));
  });

  it('延ばした日付は、その日の日本時間の終わり', () => {
    expect(deadlineOf('2026-12-31')).toBe(Date.parse('2027-01-01T00:00:00+09:00'));
    expect(deadlineOf('2028-02-29')).toBe(Date.parse('2028-03-01T00:00:00+09:00'));
  });

  // 日付欄の値は年が4桁より長くてもよく、Chrome は max が無いと6桁まで打たせる。
  it('年が5桁以上の日付も、その日の日本時間の終わり', () => {
    expect(deadlineOf('20261-01-01')).toBe(Date.UTC(20261, 0, 2) - 9 * 60 * 60 * 1000);
    expect(deadlineOf('275760-09-12')).toBe(Date.UTC(275760, 8, 13) - 9 * 60 * 60 * 1000);
  });

  it('日付として読めないもの（空・形が違う・3桁の年・無い日・0〜99年・Date で表せない年）は null', () => {
    for (const value of ['', '2026-10', '2026/10/18', '2026-10-18T00:00', 'x2026-10-18', '999-12-31', '275761-01-01', '2026-02-29', '2026-13-01', '2026-10-32', '2026-00-10', '0099-01-01']) {
      expect(deadlineOf(value), value).toBeNull();
    }
  });
});

describe('SOUND_LEVEL・parseMuted — 音の大きさと消音', () => {
  it('全体の大きさは控えめ（半分より小さく、0 ではない）', () => {
    expect(SOUND_LEVEL).toBeGreaterThan(0);
    expect(SOUND_LEVEL).toBeLessThan(0.5);
  });

  it("消音として読むのは '1' だけで、無い・ほかの値は音を出す", () => {
    expect(parseMuted('1')).toBe(true);
    for (const value of [null, '', '0', 'true', ' 1']) {
      expect(parseMuted(value), String(value)).toBe(false);
    }
  });
});
