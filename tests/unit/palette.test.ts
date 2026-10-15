import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TONES, DARK_TONES } from '../../src/components/tones';
import { contrastRatio, meetsAA } from '../../src/lib/contrast';
import { hasHexColor, parseCustomProperties, resolve, stripComments } from '../../src/lib/tokens';

/**
 * src/styles/tokens.css が docs/DESIGN.md §4 の配色ルールを満たしているか。
 *
 * **値をここに書き写さない。** 色の literal は tokens.css の1箇所にしか無い
 * （Issue rurino-nemo-fansite#5 の完了条件）ので、テストは CSS を読んで確かめる。
 * 書き写した瞬間に literal が2箇所になり、守らせたい規約そのものが壊れる。
 *
 * tests/unit/contrast.test.ts との役割分担:
 *   - contrast.test.ts = 計算が DESIGN.md §4 の表どおりの数を出すか（道具の検査）
 *   - ここ            = 実装のトークンが、置かれる地の上で規約を満たすか（実装の検査）
 */
const read = (relPath: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relPath}`, import.meta.url)), 'utf8');

const tokens = parseCustomProperties(read('src/styles/tokens.css'));
const value = (name: string) => resolve(tokens, name);

/** 地。tokens.css の役割名がそのまま「どの地か」を表している。 */
const paper = value('--color-surface');
const ground = value('--color-bg');

describe('src/styles/tokens.css — 色の literal は1箇所だけ', () => {
  it('パレット（--c-*）以外に16進数が書かれていない', () => {
    const violations = [...tokens]
      .filter(([name, raw]) => !name.startsWith('--c-') && hasHexColor(raw))
      .map(([name, raw]) => `${name}: ${raw}`);
    expect(violations).toEqual([]);
  });

  it('役割トークン（--color-*）は必ずパレットへ辿り着く', () => {
    const colorRoles = [...tokens.keys()].filter((name) => name.startsWith('--color-'));
    expect(colorRoles.length).toBeGreaterThan(0);
    for (const name of colorRoles) {
      expect(value(name), `${name} が色に解決されない`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('docs/DESIGN.md §4 — 地ごとに使える色が変わる', () => {
  it('本文はどちらの地でも AA', () => {
    expect(meetsAA(contrastRatio(value('--color-text'), paper))).toBe(true);
    expect(meetsAA(contrastRatio(value('--color-text'), ground))).toBe(true);
  });

  it('リンクは地ごとに色を変える — 白地用を青い地に置くと AA を満たさない', () => {
    expect(meetsAA(contrastRatio(value('--color-link-on-paper'), paper))).toBe(true);
    expect(meetsAA(contrastRatio(value('--color-link-on-ground'), ground))).toBe(true);
    // 「地が変わったら色も変える」の根拠。ここが真でなくなったら役割を分ける意味が消える。
    expect(meetsAA(contrastRatio(value('--color-link-on-paper'), ground))).toBe(false);
  });

  it('既定のリンク色はページの地（青）用', () => {
    expect(value('--color-link')).toBe(value('--color-link-on-ground'));
  });

  it('見出しは本文色 — どちらの地でも AA', () => {
    // ADR-0010 で見出しのピンクをやめた。夜の畑だけが白へ差し替える（下の「畑の上の文字」）。
    expect(value('--color-heading')).toBe(value('--color-text'));
  });

  it('差し色は白い面の上でだけ文字にできる', () => {
    expect(meetsAA(contrastRatio(value('--color-accent'), paper))).toBe(true);
    // 青い地では 4.49。AA に届かないので、SectionLabel は白い面の中でしか使えない。
    expect(meetsAA(contrastRatio(value('--color-accent'), ground))).toBe(false);
  });

  /**
   * この配色の要。地の #A2C7F3 の上に置ける文字色は **本文色ただ1つ**しかない。
   * これが「色を使いたい文字は白い面へ上げる」の根拠であり、
   * .on-paper / .on-ground を対で持つ理由でもある。
   * パレットを触ってここが2色以上になったら、その時点で設計の前提が変わっている。
   * 面（fill）・装飾（decor）・枠（outline）・帯（band）・下地（thumb・frame）・文字の後ろのにじみ（halo）は文字ではないので外す。
   */
  it('青い地の上で AA を満たす文字色は本文色だけ', () => {
    const notText = ['--color-fill-', 'decor', 'outline', 'band', 'thumb', 'frame', 'halo', '--color-bg', '--color-surface'];
    const textRoles = [...tokens.keys()].filter(
      (name) => name.startsWith('--color-') && !notText.some((part) => name.includes(part)),
    );
    const passing = textRoles.filter((name) => meetsAA(contrastRatio(value(name), ground)));
    // --color-text / --color-link-on-ground / --color-link / --color-heading は同じ値（本文色）に解決する。
    expect(new Set(passing.map((name) => value(name)))).toEqual(new Set([value('--color-text')]));
  });
});

/**
 * ステッカーの面（ADR-0010）。淡い面には本文色、濃い面には白。
 * どれも不透明な面なので axe も測るが、組の根拠をここに書いておく。
 */
describe('docs/adr/0010 — ステッカーの面と文字色', () => {
  it.each(['--color-fill-lavender', '--color-fill-pink-soft', '--color-fill-ground', '--color-surface'])(
    '%s の上に本文色が AA',
    (fill) => {
      expect(meetsAA(contrastRatio(value('--color-text'), value(fill)))).toBe(true);
    },
  );

  it.each(['--color-band', '--color-fill-ink'])('%s の上に白が AA（帯・フッター・夜のピル）', (fill) => {
    expect(meetsAA(contrastRatio(value('--color-text-on-fill'), value(fill)))).toBe(true);
  });

  it('装飾の紫とピンクは文字にできない — 白地で大字にも届かないか、大字のみ', () => {
    expect(meetsAA(contrastRatio(value('--color-decor-violet'), paper), 'large')).toBe(false);
    expect(meetsAA(contrastRatio(value('--color-decor-pink'), paper), 'normal')).toBe(false);
  });
});

describe('docs/DESIGN.md §4 — 面にしか使わない色', () => {
  it('黄は文字色にできない — 白地では大字でも AA を満たさない', () => {
    const ratio = contrastRatio(value('--color-fill-amber'), paper);
    expect(meetsAA(ratio, 'large')).toBe(false);
  });
});

/**
 * バッジの語彙（src/components/tones.ts）と、パレット（tokens.css）の対応。
 *
 * **面と文字色は組でしか使えない。** その組を CategoryBadge.tsx が握っているので、
 * ここは「握っている組が本当に AA か」と「tone を足したら色も足したか」を見る。
 * tone の一覧をテストに書き写さないので、tones.ts に1つ足しただけでここが落ちる。
 */
/**
 * トップのネモフィラ畑（docs/adr/0009-nemophila-field-hero.md）。
 *
 * **axe はここを測れない。** 見出しは CSS のグラデーションと WebGL のキャンバスの上にあり、
 * axe は地の色を確定できずに incomplete へ落として素通りする。だから比はここで見る。
 *
 * 状態ごとの文字色とにじみの色の組は NemophilaField.module.css が握っている — ふだん・配信前は本文色に白のにじみ、
 * 配信中（夜）は白に夜の濃紺のにじみ。テストは CSS の選び方を読まず、下の表に書き写している。
 * 組を変えたら（--field-ink も --field-halo も）下の表も直す。
 * 見出しと添え書きは空・霞・霧の上にある。見出しは画面の形によっては地平線より下
 * （地面が覗く畑）に掛かるので、見出しの大きさ（大字）で地面とも比べる。
 * 添え書き（小さい字）も背の低い画面では花に掛かるが、地面の上の比は小さい字の基準に届かない。
 * そこは文字の後ろに敷くにじみ（NemophilaField.module.css の --field-halo）が支えていて、ここでは表せない。
 * 描いた畑の上で測るのは scripts/measure-field-contrast.mjs（`pnpm field:contrast`。CI では回らない）。
 * ピルは不透明な面の上なので、ここでは見ない（axe が測る）。
 */
describe('docs/adr/0009 — 畑の上の文字', () => {
  const states = [
    { state: 'day', ink: '--color-text', halo: '--color-halo' },
    { state: 'soon', ink: '--color-text', halo: '--color-halo' },
    { state: 'live', ink: '--color-text-on-fill', halo: '--color-halo-night' },
  ] as const;

  describe.each(states)('$state', ({ state, ink, halo }) => {
    it.each(['sky', 'haze', 'fog'])(`${ink} は %s の上で AA`, (part) => {
      expect(meetsAA(contrastRatio(value(ink), value(`--c-field-${state}-${part}`)))).toBe(true);
    });

    // にじみは後ろをこの色へ寄せるので、文字色とにじみの色そのものが AA でないと、敷くほど読めなくなる。
    // 花の上で実際に足りるかは、ここでは表せない（上の注の scripts/measure-field-contrast.mjs）。
    it(`${ink} はにじみの色 ${halo} の上で AA`, () => {
      expect(meetsAA(contrastRatio(value(ink), value(halo)))).toBe(true);
    });

    it(`${ink} は地面の上でも大字なら AA`, () => {
      expect(meetsAA(contrastRatio(value(ink), value(`--c-field-${state}-ground`)), 'large')).toBe(true);
    });
  });

  it('夜の空に本文色は置けない — 配信中に白へ切り替える理由', () => {
    expect(meetsAA(contrastRatio(value('--color-text'), value('--c-field-live-sky')), 'large')).toBe(false);
  });

  it('昼の空に白は置けない — ふだんを本文色にしておく理由', () => {
    expect(meetsAA(contrastRatio(value('--color-text-on-fill'), value('--c-field-day-sky')), 'large')).toBe(false);
  });
});

describe('src/components/tones.ts — 分類バッジの面と文字色は組', () => {
  const fill = (tone: string) => value(`--color-fill-${tone}`);

  it.each([...TONES])('%s の面がパレットに解決する', (tone) => {
    expect(fill(tone)).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it.each([...DARK_TONES])('%s は濃い面 — 白文字が AA', (tone) => {
    expect(meetsAA(contrastRatio(value('--color-text-on-fill'), fill(tone)))).toBe(true);
  });

  const paleTones = TONES.filter((tone) => !DARK_TONES.includes(tone));

  it.each([...paleTones])('%s は淡い面 — 本文色が AA', (tone) => {
    expect(meetsAA(contrastRatio(value('--color-text'), fill(tone)))).toBe(true);
  });

  it.each([...paleTones])('%s に白文字を置くと落ちる — 組を崩せない根拠', (tone) => {
    expect(meetsAA(contrastRatio(value('--color-text-on-fill'), fill(tone)))).toBe(false);
  });
});

describe('docs/DESIGN.md §4 — 白い面でだけ使える文字色', () => {
  it('補助文は白い面の上でだけ AA', () => {
    // ラベル・注記・「未確認」チップの文字。本文より小さく出すので、
    // 大字の下限ではなく通常サイズの 4.5 で見る。
    expect(meetsAA(contrastRatio(value('--color-text-muted'), paper))).toBe(true);
    // 青い地では 3.40。地に直に置く出典の行（再生リスト）を本文色にしてあるのはこれが理由。
    expect(meetsAA(contrastRatio(value('--color-text-muted'), ground))).toBe(false);
  });

  it('補助文は本文より薄い', () => {
    // 「薄いのに AA」が要件。本文と同じ濃さなら役割を分ける意味が無い。
    expect(contrastRatio(value('--color-text-muted'), paper)).toBeLessThan(
      contrastRatio(value('--color-text'), paper),
    );
  });

  it('数字の色は白い面の上でだけ AA — だから数字は白いタイルに乗る', () => {
    expect(meetsAA(contrastRatio(value('--color-figure'), paper))).toBe(true);
    // 青い地では 4.28。StatTile が .on-paper を内側に持っているのはこのため。
    expect(meetsAA(contrastRatio(value('--color-figure'), ground))).toBe(false);
  });

  it('地の上の装飾は白 — 文字ではないので比の下限はかからない', () => {
    // ドット・花。ここが文字色として使われ始めたら 1.75 で破綻するので、
    // 「文字には使えない」ことを明示しておく。
    expect(meetsAA(contrastRatio(value('--color-decor'), ground), 'large')).toBe(false);
  });
});

describe('docs/DESIGN.md §4 — 書体', () => {
  it('どの書体スタックも sans-serif で終わる（明朝は使わない）', () => {
    for (const name of [...tokens.keys()].filter((n) => n.startsWith('--font-'))) {
      expect(value(name), `${name} の末尾`).toMatch(/sans-serif$/);
    }
  });

  it('見出しの書体は、本文スタックへ落ちる', () => {
    expect(value('--font-display')).toContain(value('--font-sans'));
  });

  it('webfont は src/styles/fonts.css にだけ置く', () => {
    // Storybook と同期先は tokens.css と global.css を読み、fonts.css は読まない（.storybook/preview.ts）。
    // ここに webfont を書くと、読まないはずの場所に数 MB のチャンクが付いていく。
    // **コメントは外してから見る。** 規約を説明した文章そのものに反応させない。
    for (const css of ['src/styles/tokens.css', 'src/styles/global.css']) {
      expect(stripComments(read(css)), css).not.toMatch(/@font-face|@import/);
    }
  });
});

describe('docs/DESIGN.md §6 — 本文は最低 16px', () => {
  it('--text-base が 1rem', () => {
    expect(value('--text-base')).toBe('1rem');
  });
});
