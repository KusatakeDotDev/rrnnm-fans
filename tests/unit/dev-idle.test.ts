import { describe, expect, it } from 'vitest';

import { DEV_IDLE_SLEEP_FACTOR, devIdleReason, isOwnLockFile, parseIdleMinutes, sleptSince } from '../../src/lib/dev-idle';

/**
 * src/lib/dev-idle.ts — 使われていない開発サーバーを止めるかどうか（astro.config.mjs の dev-idle-shutdown）。
 * 時刻は 0 から始め、決まりの長さは 10 と 60 にして、境目（ちょうど・1 手前）を見る。
 */
const limits = { idleMs: 10, maxMs: 60 };

describe('誰も使っていない（idle）', () => {
  it('ブラウザが無く、リクエストも来ないまま idleMs たったら止める', () => {
    expect(devIdleReason({ now: 10, browsers: 0, lastBrowserAt: 0, lastRequestAt: 0 }, limits)).toBe('idle');
  });

  it('idleMs の1手前では止めない', () => {
    expect(devIdleReason({ now: 9, browsers: 0, lastBrowserAt: 0, lastRequestAt: 0 }, limits)).toBeNull();
  });

  it('最後にリクエストが来た時刻から数える（ブラウザ無しで叩き続けているあいだは止めない）', () => {
    expect(devIdleReason({ now: 20, browsers: 0, lastBrowserAt: 0, lastRequestAt: 11 }, limits)).toBeNull();
    expect(devIdleReason({ now: 21, browsers: 0, lastBrowserAt: 0, lastRequestAt: 11 }, limits)).toBe('idle');
  });

  it('最後にブラウザがつながっていた時刻から数える（タブを閉じた直後は止めない）', () => {
    expect(devIdleReason({ now: 20, browsers: 0, lastBrowserAt: 11, lastRequestAt: 0 }, limits)).toBeNull();
    expect(devIdleReason({ now: 21, browsers: 0, lastBrowserAt: 11, lastRequestAt: 0 }, limits)).toBe('idle');
  });

  it('ブラウザがつながっていれば、idle では止めない', () => {
    expect(devIdleReason({ now: 59, browsers: 1, lastBrowserAt: 0, lastRequestAt: 0 }, limits)).toBeNull();
  });

  it('ブラウザの数が分からないときは、idle では止めない', () => {
    expect(devIdleReason({ now: 59, browsers: null, lastBrowserAt: 0, lastRequestAt: 0 }, limits)).toBeNull();
  });

  it('両方に当たるときは idle を返す', () => {
    expect(devIdleReason({ now: 60, browsers: 0, lastBrowserAt: 0, lastRequestAt: 0 }, limits)).toBe('idle');
  });
});

describe('開いたまま放ってある（max）', () => {
  it('ブラウザがつながっていても、リクエストが来ないまま maxMs たったら止める', () => {
    expect(devIdleReason({ now: 60, browsers: 1, lastBrowserAt: 60, lastRequestAt: 0 }, limits)).toBe('max');
  });

  it('maxMs の1手前では止めない', () => {
    expect(devIdleReason({ now: 59, browsers: 1, lastBrowserAt: 59, lastRequestAt: 0 }, limits)).toBeNull();
  });

  it('ブラウザの数が分からなくても、max では止める', () => {
    expect(devIdleReason({ now: 60, browsers: null, lastBrowserAt: 0, lastRequestAt: 0 }, limits)).toBe('max');
  });

  it('ブラウザがつながっていた時刻ではなく、リクエストの時刻だけで数える', () => {
    expect(devIdleReason({ now: 70, browsers: 1, lastBrowserAt: 70, lastRequestAt: 10 }, limits)).toBe('max');
    expect(devIdleReason({ now: 70, browsers: 1, lastBrowserAt: 70, lastRequestAt: 11 }, limits)).toBeNull();
  });
});

describe('止めない設定（Infinity）', () => {
  it('どちらも Infinity なら、いつまでも止めない', () => {
    const never = { idleMs: Infinity, maxMs: Infinity };
    expect(devIdleReason({ now: 1e12, browsers: 0, lastBrowserAt: 0, lastRequestAt: 0 }, never)).toBeNull();
  });
});

describe('sleptSince — 見回りの間に PC が眠っていたか', () => {
  it('間隔の3倍までは眠っていたとみなさない', () => {
    expect(sleptSince(0, 30 * DEV_IDLE_SLEEP_FACTOR, 30)).toBe(false);
  });

  it('間隔の3倍を超えて空いたら、眠っていたとみなす', () => {
    expect(sleptSince(0, 30 * DEV_IDLE_SLEEP_FACTOR + 1, 30)).toBe(true);
  });

  it('前の見回りの時刻から数える', () => {
    expect(sleptSince(1000, 1000 + 90, 30)).toBe(false);
    expect(sleptSince(1000, 1000 + 91, 30)).toBe(true);
  });
});

describe('isOwnLockFile — .astro/dev.json がこのプロセスのものか', () => {
  it('pid が同じなら true', () => {
    expect(isOwnLockFile(JSON.stringify({ pid: 123, port: 4321 }), 123)).toBe(true);
  });

  it('pid が別なら false', () => {
    expect(isOwnLockFile(JSON.stringify({ pid: 456, port: 4321 }), 123)).toBe(false);
  });

  it('pid が文字列なら false（同じ数字でも）', () => {
    expect(isOwnLockFile(JSON.stringify({ pid: '123' }), 123)).toBe(false);
  });

  it('pid が無い・オブジェクトでない・null・JSON でないなら false', () => {
    expect(isOwnLockFile(JSON.stringify({ port: 4321 }), 123)).toBe(false);
    expect(isOwnLockFile('123', 123)).toBe(false);
    expect(isOwnLockFile('null', 123)).toBe(false);
    expect(isOwnLockFile('{', 123)).toBe(false);
  });
});

describe('parseIdleMinutes — 環境変数の分をミリ秒にする', () => {
  it('未設定・空・空白だけなら既定の分', () => {
    expect(parseIdleMinutes(undefined, 10)).toBe(600_000);
    expect(parseIdleMinutes('', 60)).toBe(3_600_000);
    expect(parseIdleMinutes('  ', 10)).toBe(600_000);
  });

  it('分をミリ秒にする（小数も、前後の空白も可）', () => {
    expect(parseIdleMinutes('1.5', 10)).toBe(90_000);
    expect(parseIdleMinutes('1.25', 10)).toBe(75_000);
    expect(parseIdleMinutes('15', 10)).toBe(900_000);
    expect(parseIdleMinutes(' 2 ', 10)).toBe(120_000);
  });

  it('0 なら止めない（Infinity）', () => {
    expect(parseIdleMinutes('0', 10)).toBe(Infinity);
  });

  it('数でない・負・無限大は投げる（メッセージに渡した値を出す）', () => {
    expect(() => parseIdleMinutes('abc', 10)).toThrow(TypeError);
    expect(() => parseIdleMinutes('abc', 10)).toThrow(/分は 0 以上の数で書く.*abc/);
    expect(() => parseIdleMinutes('-1', 10)).toThrow(TypeError);
    expect(() => parseIdleMinutes('Infinity', 10)).toThrow(TypeError);
  });

  it('10進の数でない書き方は、Number() が読めても投げる', () => {
    for (const value of ['0x10', '1e2', '1.', '.5', '1.5.2', '1 0', 'a1', '1a']) {
      expect(() => parseIdleMinutes(value, 10), value).toThrow(TypeError);
    }
  });
});
