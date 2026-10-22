import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  coversAny,
  fontFaceRules,
  onlyFontFaces,
  parseUnicodeRange,
  webfontFamilies,
  withoutFontFaces,
} from '../../src/lib/font-face';
import { parseCustomProperties, resolve } from '../../src/lib/tokens';

describe('@font-face の読み取り', () => {
  it('minify された CSS から、ファミリ・最初の url・unicode-range を読む', () => {
    const css =
      '@font-face{font-family:Zen Maru Gothic;font-style:normal;font-weight:400;' +
      'src:url(/_astro/a.woff2)format("woff2"),url(/_astro/a.woff)format("woff");unicode-range:U+3063,U+3066}';
    expect(fontFaceRules(css)).toEqual([
      { family: 'Zen Maru Gothic', url: '/_astro/a.woff2', unicodeRange: 'U+3063,U+3066' },
    ]);
  });

  it('整形された CSS と、クォートで囲んだ値・url() の内側の空白も読む', () => {
    const css = `
      @font-face {
        font-family: 'Zen Maru Gothic';
        src: url( "./files/a.woff2" ) format('woff2');
        unicode-range: U+3063, U+3066-3068;
      }
    `;
    expect(fontFaceRules(css)).toEqual([
      { family: 'Zen Maru Gothic', url: './files/a.woff2', unicodeRange: 'U+3063, U+3066-3068' },
    ]);
  });

  // 最後の宣言はセミコロンを省略できる（minify された実物がこの形）。宣言の順も保証されない。
  it('最後の宣言にセミコロンが無くても、宣言の順が違っても読む', () => {
    expect(fontFaceRules('@font-face{unicode-range:U+3063;src:url(/a.woff2);font-family:Zen Maru Gothic}')).toEqual([
      { family: 'Zen Maru Gothic', url: '/a.woff2', unicodeRange: 'U+3063' },
    ]);
  });

  it('セミコロンの無い最後の値は、後ろの空白を落とす', () => {
    expect(fontFaceRules('@font-face {\n  font-family: A;\n  unicode-range: U+3063, U+3066\n}')[0]?.unicodeRange).toBe(
      'U+3063, U+3066',
    );
  });

  it('ファミリ名の両端のクォートだけを外し、名前の途中のクォートは残す', () => {
    expect(fontFaceRules(`@font-face{font-family:"A'B";src:url(/a.woff2)}`)[0]?.family).toBe("A'B");
  });

  it('local() だけの面は url が null、unicode-range の無い面は unicodeRange が null', () => {
    expect(fontFaceRules("@font-face{font-family:'Zen Maru Gothic Fallback';src:local('Meiryo')}")).toEqual([
      { family: 'Zen Maru Gothic Fallback', url: null, unicodeRange: null },
    ]);
  });

  // 他のプロパティ名の一部（`font-family` の中の `family` など）に引っかからない。
  it('名前の一部が同じ別のプロパティを拾わない', () => {
    expect(fontFaceRules('@font-face{font-src:x;font-family:A}')[0]?.url).toBeNull();
  });

  it('@font-face が無ければ空', () => {
    expect(fontFaceRules('body{color:red}')).toEqual([]);
  });

  it('ファミリ名を書かれた順に返し、ファミリの無い面は数えない', () => {
    const css =
      "@font-face{font-family:'Zen Maru Gothic';src:url(/a.woff2)}" +
      '@font-face{src:url(/b.woff2)}' +
      '@font-face{font-family:"Zen Maru Gothic Fallback";src:local(Meiryo)}';
    expect(webfontFamilies(css)).toEqual(['Zen Maru Gothic', 'Zen Maru Gothic Fallback']);
  });

  it('@font-face とそれ以外に分ける', () => {
    const css = 'body{color:red}@font-face{font-family:A}h1{color:blue}@font-face{font-family:B}';
    expect(onlyFontFaces(css)).toBe('@font-face{font-family:A}@font-face{font-family:B}');
    expect(withoutFontFaces(css)).toBe('body{color:red}h1{color:blue}');
  });

  it('@font-face が無ければ、@font-face だけを取り出すと空', () => {
    expect(onlyFontFaces('body{color:red}')).toBe('');
  });
});

describe('unicode-range', () => {
  it('単体指定と範囲指定を、範囲の並びにする', () => {
    expect(parseUnicodeRange('U+3063,U+41-43')).toEqual([
      [0x3063, 0x3063],
      [0x41, 0x43],
    ]);
  });

  it('空白・小文字混じりでも読める', () => {
    expect(parseUnicodeRange('u+41, U+43 - 44')).toEqual([
      [0x41, 0x41],
      [0x43, 0x44],
    ]);
  });

  it('範囲の両端の字に当たり、外の字には当たらない', () => {
    expect(coversAny('U+41-43', [0x41])).toBe(true);
    expect(coversAny('U+41-43', [0x43])).toBe(true);
    expect(coversAny('U+41-43', [0x40, 0x44])).toBe(false);
  });

  it('unicode-range の無い面（null）は、どの字にも当たる', () => {
    expect(coversAny(null, [0x10ffff])).toBe(true);
  });

  it('字が無ければ当たらない', () => {
    expect(coversAny('U+0-10FFFF', [])).toBe(false);
  });

  it('性質: 単体指定で並べた字は、どれも当たる', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 0x10ffff }), { minLength: 1 }), (codePoints) => {
        const range = codePoints.map((codePoint) => `U+${codePoint.toString(16)}`).join(',');
        expect(codePoints.every((codePoint) => coversAny(range, [codePoint]))).toBe(true);
      }),
    );
  });
});

/**
 * 本文のスタックの先頭2つが、src/styles/fonts.css が読み込むファミリと、src/styles/font-fallback.css が定義する
 * ファミリになっているか。名前を書き違えると、webfont もフォールバックも黙って使われず、端末の書体で描かれる。
 * **値をテストに書き写さない。** tokens.css・fonts.css・font-fallback.css と、Fontsource の CSS を読んで突き合わせる
 * （palette.test.ts が tokens.css を読むのと同じ理由。docs/adr/0003-testing-and-ci.md §2）。
 */
describe('src/styles/tokens.css の --font-sans と、fonts.css・font-fallback.css', () => {
  const read = (relPath: string) =>
    readFileSync(fileURLToPath(new URL(`../../${relPath}`, import.meta.url)), 'utf8');

  const fontsCss = read('src/styles/fonts.css');
  const imported = [...fontsCss.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map(([, specifier]) =>
    readFileSync(fileURLToPath(import.meta.resolve(specifier!)), 'utf8'),
  );
  const stack = resolve(parseCustomProperties(read('src/styles/tokens.css')), '--font-sans')
    .split(',')
    .map((family) => family.trim().replace(/^["']|["']$/g, ''));

  it('fonts.css が webfont の CSS を読み込んでいる', () => {
    // 空だと下の検査が素通りする。前提を先に確かめる。
    expect(imported.length).toBeGreaterThan(0);
  });

  it('先頭は、読み込んだ webfont のファミリ', () => {
    expect(new Set(imported.flatMap(webfontFamilies))).toEqual(new Set([stack[0]]));
  });

  it('2番目は、font-fallback.css が定義するフォールバックのファミリ', () => {
    expect(new Set(webfontFamilies(read('src/styles/font-fallback.css')))).toEqual(new Set([stack[1]]));
  });

  // fonts.css は描画を止めずに後から読む（Base.astro）。ここに面を書くと、その面も後から当たる。
  it('fonts.css は、webfont の CSS を読み込むだけで、自分では面を定義しない', () => {
    expect(webfontFamilies(fontsCss)).toEqual([]);
  });
});
