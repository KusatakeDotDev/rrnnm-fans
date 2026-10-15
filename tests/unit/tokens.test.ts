import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { hasHexColor, parseCustomProperties, resolve, stripComments } from '../../src/lib/tokens';

describe('CSS カスタムプロパティの読み取り', () => {
  it('宣言を名前と値の対にする', () => {
    const tokens = parseCustomProperties(':root { --a: #FFFFFF; --b: 1rem; }');
    expect(tokens.get('--a')).toBe('#FFFFFF');
    expect(tokens.get('--b')).toBe('1rem');
  });

  it('コメントの中の宣言は拾わない', () => {
    const tokens = parseCustomProperties(':root { /* --a: #000000; */ --a: #FFFFFF; }');
    expect(tokens.get('--a')).toBe('#FFFFFF');
    expect(tokens.size).toBe(1);
  });

  it('複数行に跨る値の空白を1つに畳む', () => {
    const tokens = parseCustomProperties(':root { --font:\n  system-ui,\n  "Yu Gothic UI",\n  sans-serif; }');
    expect(tokens.get('--font')).toBe('system-ui, "Yu Gothic UI", sans-serif');
  });

  it('同じ名前が2回出たら後勝ち（CSS の規則と同じ）', () => {
    const tokens = parseCustomProperties(':root { --a: #000000; } :root { --a: #FFFFFF; }');
    expect(tokens.get('--a')).toBe('#FFFFFF');
  });

  it('カスタムプロパティでない宣言は拾わない', () => {
    const tokens = parseCustomProperties(':root { color-scheme: light; --a: #FFFFFF; }');
    expect([...tokens.keys()]).toEqual(['--a']);
  });

  /**
   * 取りこぼしても例外は出ず、**検査するトークンが静かに減るだけ**になる。
   * パレット検査（palette.test.ts）が空振りしていても気付けないので、
   * CSS が許す空白の書き方は全部拾えることを確かめておく。
   */
  it.each([
    ['--a:#FFFFFF;', 'コロンの後に空白が無い'],
    ['--a : #FFFFFF;', 'コロンの前に空白がある'],
    ['--a:   #FFFFFF;', 'コロンの後に空白が複数'],
    ['--a:\n  #FFFFFF;', 'コロンの後が改行'],
    ['--a\t:\t#FFFFFF;', 'タブ区切り'],
  ])('%s も拾う（%s）', (declaration) => {
    expect(parseCustomProperties(`:root { ${declaration} }`).get('--a')).toBe('#FFFFFF');
  });

  it('コメントだけを外す', () => {
    expect(stripComments('a /* x */ b /* y */ c')).toBe('a  b  c');
    expect(stripComments('a /* 複数\n行 */ b')).toBe('a  b');
  });
});

describe('var() の解決', () => {
  it('1段の参照を解く', () => {
    const tokens = parseCustomProperties(':root { --palette: #FFFFFF; --role: var(--palette); }');
    expect(resolve(tokens, '--role')).toBe('#FFFFFF');
  });

  it('多段の参照を解く', () => {
    const tokens = parseCustomProperties(
      ':root { --a: #FFFFFF; --b: var(--a); --c: var(--b); --d: var(--c); }',
    );
    expect(resolve(tokens, '--d')).toBe('#FFFFFF');
  });

  it('値の一部に埋まった参照を解く', () => {
    const tokens = parseCustomProperties(':root { --base: sans-serif; --display: "Zen", var(--base); }');
    expect(resolve(tokens, '--display')).toBe('"Zen", sans-serif');
  });

  it('1つの値に参照が複数あっても全部解く', () => {
    const tokens = parseCustomProperties(':root { --a: 1px; --b: 2px; --c: var(--a) var(--b); }');
    expect(resolve(tokens, '--c')).toBe('1px 2px');
  });

  it('参照が無い値はそのまま返す', () => {
    const tokens = parseCustomProperties(':root { --a: #FFFFFF; }');
    expect(resolve(tokens, '--a')).toBe('#FFFFFF');
  });

  it.each([
    ['var(--a)', '空白なし'],
    ['var( --a )', '括弧の内側に空白'],
    ['var(  --a)', '前だけ空白'],
    ['var(--a  )', '後だけ空白'],
  ])('%s を解く（%s）', (reference) => {
    const tokens = parseCustomProperties(`:root { --a: #FFFFFF; --b: ${reference}; }`);
    expect(resolve(tokens, '--b')).toBe('#FFFFFF');
  });

  it('未定義のトークンは投げる', () => {
    const tokens = parseCustomProperties(':root { --a: var(--missing); }');
    expect(() => resolve(tokens, '--a')).toThrow(/未定義のトークン: --missing/);
    expect(() => resolve(tokens, '--nope')).toThrow(/未定義のトークン: --nope/);
  });

  it('循環参照は投げる（無限ループにしない）', () => {
    const tokens = parseCustomProperties(':root { --a: var(--b); --b: var(--a); }');
    expect(() => resolve(tokens, '--a')).toThrow(/循環/);
  });
});

describe('16進数の色の検出', () => {
  it.each(['#FFF', '#ffffff', '#FFFFFF80', 'solid 1px #E25B82'])('%s は色の literal', (value) => {
    expect(hasHexColor(value)).toBe(true);
  });

  it.each(['var(--c-pink)', 'sans-serif', '1rem', 'clamp(1.5rem, 1.15rem + 1.5vw, 1.875rem)'])(
    '%s は色の literal ではない',
    (value) => {
      expect(hasHexColor(value)).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// 性質ベース
// ---------------------------------------------------------------------------

const tokenName = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,20}$/)
  .map((s) => `--${s}`);

const plainValue = fc.stringMatching(/^[a-zA-Z0-9 .,%#"-]{1,30}$/).filter((s) => !s.includes('var('));

describe('読み取りと解決の性質', () => {
  it('書き出した宣言は必ず同じ値で読み戻せる', () => {
    fc.assert(
      fc.property(tokenName, plainValue, (name, value) => {
        const css = `:root { ${name}: ${value}; }`;
        const tokens = parseCustomProperties(css);
        expect(tokens.get(name)).toBe(value.trim().replace(/\s+/g, ' '));
      }),
    );
  });

  it('何段のエイリアスを挟んでも、解決した値は元の値と同じ', () => {
    fc.assert(
      fc.property(plainValue, fc.integer({ min: 1, max: 10 }), (value, depth) => {
        const declarations = [`--t0: ${value};`];
        for (let i = 1; i <= depth; i += 1) declarations.push(`--t${i}: var(--t${i - 1});`);
        const tokens = parseCustomProperties(`:root { ${declarations.join(' ')} }`);
        expect(resolve(tokens, `--t${depth}`)).toBe(value.trim().replace(/\s+/g, ' '));
      }),
    );
  });

  it('解決した値には var( が残らない', () => {
    fc.assert(
      fc.property(plainValue, fc.integer({ min: 0, max: 10 }), (value, depth) => {
        const declarations = [`--t0: ${value};`];
        for (let i = 1; i <= depth; i += 1) declarations.push(`--t${i}: var(--t${i - 1});`);
        const tokens = parseCustomProperties(`:root { ${declarations.join(' ')} }`);
        expect(resolve(tokens, `--t${depth}`)).not.toContain('var(');
      }),
    );
  });
});
