import fc from 'fast-check';
import { describe, expect, it } from 'vite-plus/test';

import { cx } from '../../src/lib/cx';

/**
 * src/lib/cx.ts — React のコンポーネントのクラス名をつなぐ（docs/adr/0011-react-components-for-design-sync.md）。
 * 壊れると「呼び出し側のクラスが黙って落ちる」「class 属性に undefined や余分な空白が出る」の形で出る。
 */
describe('cx', () => {
  it('渡した順に空白1つでつなぐ', () => {
    expect(cx('card', 'on-paper', 'schedule-sticker')).toBe('card on-paper schedule-sticker');
  });

  it('無いもの（undefined・null・false・空文字・空白だけ）は飛ばす', () => {
    expect(cx('card', undefined, null, false, '', '  ', 'on-paper')).toBe('card on-paper');
  });

  it('何も無ければ空文字', () => {
    expect(cx()).toBe('');
    expect(cx(undefined, false)).toBe('');
  });

  it('前後と途中の余分な空白を詰める', () => {
    expect(cx('card', ' on-paper')).toBe('card on-paper');
    expect(cx('a', ' b ')).toBe('a b');
    expect(cx('a  b ', '\tc\n')).toBe('a b c');
  });

  it('どんな空白の入れ方でも、名前は順に欠けずに残り、空白は1つずつしか出ない', () => {
    const name = fc.stringMatching(/^[a-z][a-z0-9_-]*$/);
    const blank = fc.constantFrom('', ' ', '  ', '\t', '\n');
    // 1つの引数に、空白で区切った名前をいくつか入れる（`className="a  b"` の形）。
    const arg = fc.oneof(
      fc.tuple(blank, fc.array(name, { maxLength: 3 }), blank, blank).map(([head, names, sep, tail]) => ({
        value: head + names.join(sep === '' ? ' ' : sep) + tail,
        names,
      })),
      fc.constantFrom(undefined, null, false).map((value) => ({ value, names: [] as string[] })),
    );
    fc.assert(
      fc.property(fc.array(arg), (args) => {
        const result = cx(...args.map((a) => a.value));
        expect(result).toBe(args.flatMap((a) => a.names).join(' '));
        expect(result).not.toMatch(/^\s|\s$|\s{2}|[\t\n]/);
      }),
    );
  });
});
