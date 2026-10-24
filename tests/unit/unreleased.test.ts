import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vite-plus/test';

import { isInside, isRouteVisible, parseShowUnreleased, unreleasedRoute } from '../../src/lib/unreleased';

describe('ADR-0018「本番に漏らしていないことを、配る前に確かめる」 — SHOW_UNRELEASED の読み方', () => {
  it('1 はオン、0 はオフ。どのコマンドでも同じ', () => {
    for (const command of ['dev', 'build', 'preview', 'sync'] as const) {
      expect(parseShowUnreleased('1', command)).toBe(true);
      expect(parseShowUnreleased('0', command)).toBe(false);
    }
  });

  it('指定が無ければ、astro dev だけオン', () => {
    expect(parseShowUnreleased(undefined, 'dev')).toBe(true);
    expect(parseShowUnreleased(undefined, 'build')).toBe(false);
    expect(parseShowUnreleased(undefined, 'preview')).toBe(false);
    expect(parseShowUnreleased(undefined, 'sync')).toBe(false);
  });

  it('1・0 以外は、空でも true・false でも、どちらにも倒さずに止める', () => {
    for (const value of ['', 'true', 'false', 'yes', ' 1', '01']) {
      expect(() => parseShowUnreleased(value, 'build')).toThrow(`SHOW_UNRELEASED は 1 か 0 で指定する（受け取った値: ${JSON.stringify(value)}）`);
      expect(() => parseShowUnreleased(value, 'dev')).toThrow('SHOW_UNRELEASED');
    }
  });
});

describe('ADR-0018「未公開のページは `src/pages/` の外に置き、オンのときだけルートに足す」 — ルートの作り方', () => {
  it('src/pages/ と同じく、index はディレクトリのルートになる', () => {
    expect(unreleasedRoute('index.astro')).toBe('/');
    expect(unreleasedRoute('play/index.astro')).toBe('/play');
    expect(unreleasedRoute('skeb.astro')).toBe('/skeb');
    expect(unreleasedRoute('play/example.astro')).toBe('/play/example');
    expect(unreleasedRoute('play/index-old.astro')).toBe('/play/index-old');
  });

  it('動的ルートは、本番の dist に残っていないかを確かめられないので止める', () => {
    expect(() => unreleasedRoute('play/[slug].astro')).toThrow('src/unreleased/ に動的ルートは置けない（play/[slug].astro）');
    expect(() => unreleasedRoute('[...rest].astro')).toThrow('（[...rest].astro）');
    expect(() => unreleasedRoute('[lang]/index.astro')).toThrow('（[lang]/index.astro）');
    expect(unreleasedRoute('_parts/[slug].astro')).toBeNull();
  });

  it('_ で始まるファイルとディレクトリ、. で始まるファイルは、ルートにしない', () => {
    expect(unreleasedRoute('_parts/Section.astro')).toBeNull();
    expect(unreleasedRoute('play/_parts/Card.tsx')).toBeNull();
    expect(unreleasedRoute('_draft.astro')).toBeNull();
    expect(unreleasedRoute('_parts/.well-known/x.txt')).toBeNull();
    expect(unreleasedRoute('.DS_Store')).toBeNull();
    expect(unreleasedRoute('play/.gitkeep')).toBeNull();
  });

  it('_ で始まらない場所の .astro 以外と、. で始まるディレクトリは、黙って見逃さずに止める', () => {
    expect(() => unreleasedRoute('skeb.ts')).toThrow('src/unreleased/ でルートにできるのは .astro だけ（skeb.ts）');
    expect(() => unreleasedRoute('play/data.json')).toThrow('（play/data.json）');
    expect(() => unreleasedRoute('notes.md')).toThrow('_ で始まるディレクトリに置く');
    expect(() => unreleasedRoute('.well-known/security.txt')).toThrow('（.well-known/security.txt）');
    expect(() => unreleasedRoute('play/.cache/x.json')).toThrow('（play/.cache/x.json）');
    expect(() => unreleasedRoute('.hidden/page.astro')).toThrow('（.hidden/page.astro）');
  });
});

describe('未公開のページへのリンクを出すか', () => {
  const hidden = ['/skeb', '/goods', '/play/example'];

  it('隠すルートが無ければ、どのリンクも出す', () => {
    for (const href of ['/', '/skeb/', '/skeb', 'skeb/', '/play/example/']) {
      expect(isRouteVisible(href, [])).toBe(true);
    }
  });

  it('末尾の / の有無、クエリ、# に関わらず、隠すルートへのリンクは出さない', () => {
    for (const href of ['/skeb/', '/skeb', '/goods/', '/skeb/?from=footer', '/skeb/#works', '/skeb?from=footer#works', '/play/example/', '/play/example']) {
      expect(isRouteVisible(href, hidden)).toBe(false);
    }
  });

  it('相対の href も、このサイトのルートに解いてから照らす', () => {
    for (const href of ['skeb/', './skeb', '../goods/', 'play/example/']) {
      expect(isRouteVisible(href, hidden)).toBe(false);
    }
    expect(isRouteVisible('about/', hidden)).toBe(true);
  });

  it('隠すルートと名前が同じ文字で始まるだけのルートや、親のルートへのリンクは出す', () => {
    for (const href of ['/about/', '/skebx/', '/skeb-old', '/goodsx', '/play/', '/play/examples/']) {
      expect(isRouteVisible(href, hidden)).toBe(true);
    }
  });

  it('日本語のルートは、そのままの href でも、パーセントエンコードした href でも照らす', () => {
    for (const href of ['/グッズ/', '/グッズ', '/%E3%82%B0%E3%83%83%E3%82%BA/']) {
      expect(isRouteVisible(href, ['/グッズ'])).toBe(false);
    }
    expect(isRouteVisible('/グッズ/', hidden)).toBe(true);
  });

  it('外のサイトへのリンクは、パスが隠すルートと同じでも出す', () => {
    for (const href of ['https://example.com/skeb/', 'https://example.com/goods', '//example.com/skeb/']) {
      expect(isRouteVisible(href, hidden)).toBe(true);
    }
  });

  it('トップ（/）へのリンクは、/ が隠すルートにあるときだけ出さない', () => {
    expect(isRouteVisible('/', ['/'])).toBe(false);
    expect(isRouteVisible('/?from=footer', ['/'])).toBe(false);
    expect(isRouteVisible('/skeb/', ['/'])).toBe(true);
    expect(isRouteVisible('/', hidden)).toBe(true);
  });
});

describe('ADR-0018「今あるページに足す区画は、コンポーネントにして import ごと差し替える」', () => {
  describe('モジュールの ID がディレクトリの中か', () => {
    it('Vite の ID（区切りが /・クエリ付き）を、Windows のパスのディレクトリと比べられる', () => {
      const dir = 'C:\\repo\\src\\unreleased';
      expect(isInside(dir, 'C:/repo/src/unreleased/_parts/Section.astro')).toBe(true);
      expect(isInside(dir, 'C:/repo/src/unreleased/_parts/Section.astro?astro&type=style&index=0&lang.css')).toBe(true);
      expect(isInside(dir, 'c:/repo/src/unreleased/skeb.astro')).toBe(true);
      expect(isInside('c:\\repo\\src\\unreleased\\', 'C:\\repo\\src\\unreleased\\skeb.astro')).toBe(true);
    });

    it('大小を無視するのは先頭のドライブ文字だけ', () => {
      expect(isInside('/repo/a:/unreleased', '/repo/A:/unreleased/skeb.astro')).toBe(false);
      expect(isInside('C:/repo/Src/unreleased', 'C:/repo/src/unreleased/skeb.astro')).toBe(false);
    });

    it('名前が同じ文字で始まるだけの隣のディレクトリや、ディレクトリそのものは中に入れない', () => {
      const dir = '/repo/src/unreleased/';
      expect(isInside(dir, '/repo/src/unreleased/skeb.astro')).toBe(true);
      expect(isInside(dir, '/repo/src/unreleased-old/skeb.astro')).toBe(false);
      expect(isInside(dir, '/repo/src/unreleased')).toBe(false);
      expect(isInside(dir, '/repo/src/lib/unreleased.ts')).toBe(false);
      expect(isInside(dir, '/other/src/unreleased/skeb.astro')).toBe(false);
      expect(isInside(dir, '/repo/src/unreleased?x=/repo/src/unreleased/skeb.astro')).toBe(false);
      expect(isInside('/repo/src/unreleased', '/repo/src/unreleased-old/skeb.astro')).toBe(false);
    });
  });

  /**
   * 差し替えるのは default export のコンポーネントだけで、差し替え先は .astro。外から import してよいのは、.astro の
   * frontmatter が default で受ける .astro・.tsx だけにする（ADR-0018「払うもの」）。<script> の中では、ブラウザに .astro が渡るため。
   * 拡張子は省かせない。省くと、実体がデータ（.ts・.json）でも見分けられないため。
   * import の書き方は数えきれないので、許す形だけを拾い、それ以外で src/unreleased/ を指す相対パスの文字列は全部違反にする。
   */
  const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
  const UNRELEASED = path.join(SRC, 'unreleased');
  const DEFAULT_IMPORT = /^\s*import\s+[A-Za-z_$][\w$]*\s+from\s*(['"])([^'"]+)\1/gm;
  const TYPE_IMPORT = /^\s*(?:import|export)\s+type\s[^'"]*?from\s*(['"])([^'"]+)\1/gm;
  const RELATIVE = /(['"`])(\.\.?\/[^'"`\n]*)\1/g;

  function violations(file: string, text: string): string[] {
    const frontmatter = file.endsWith('.astro') ? (/^---\r?\n[\s\S]*?\r?\n---/.exec(text)?.[0].length ?? 0) : 0;
    const openingQuote = (m: RegExpExecArray) => m.index + m[0].length - m[2]!.length - 2;
    const allowed = new Set([
      ...[...text.matchAll(DEFAULT_IMPORT)].filter((m) => m.index < frontmatter && /\.(astro|tsx)$/.test(m[2]!)).map(openingQuote),
      ...[...text.matchAll(TYPE_IMPORT)].map(openingQuote),
    ]);
    return [...text.matchAll(RELATIVE)]
      .filter((m) => !allowed.has(m.index) && isInside(UNRELEASED, path.resolve(path.dirname(file), m[2]!)))
      .map((m) => `${path.relative(SRC, file)}: ${m[0]}`);
  }

  it('外からの import の決まりを、違反と違反でないものの例で確かめる', () => {
    const page = path.join(SRC, 'pages', 'index.astro');
    const ok = [
      '---',
      "import Section from '../unreleased/_parts/Section.astro';",
      "import Card from '../unreleased/_parts/Card.tsx';",
      "import type { Props } from '../unreleased/_parts/Card';",
      "import site from '../lib/unreleased';",
      '---',
      '<script>',
      "import { shuffle } from '../lib/shuffle';",
      '</script>',
    ].join('\n');
    expect(violations(page, ok)).toEqual([]);
    const ng = [
      '---',
      "import { Card } from '../unreleased/_parts/Card';",
      "import * as parts from '../unreleased/_parts/Card';",
      "import data from '../unreleased/_parts/data.ts';",
      "import extensionless from '../unreleased/_parts/data';",
      "import Card from '../unreleased/_parts/Card';",
      "export { default } from '../unreleased/_parts/Card';",
      "const lazy = import('../unreleased/_parts/Card');",
      "const preloaded = import(/* preload */ '../unreleased/_parts/Card.tsx');",
      "import '../unreleased/_parts/style.css';",
      '---',
      '<script>',
      "import Card from '../unreleased/_parts/Card.tsx';",
      '</script>',
    ].join('\n');
    expect(violations(page, ng)).toHaveLength(10);
    expect(violations(path.join(SRC, 'components', 'X.tsx'), "import Card from '../unreleased/_parts/Card.tsx';")).toHaveLength(1);
  });

  it('src/ の中で、src/unreleased/ の外から入る import は、.astro が default で受けるコンポーネントだけ', () => {
    const files = readdirSync(SRC, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(astro|ts|tsx|mjs|js)$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name))
      .filter((file) => !isInside(UNRELEASED, file));
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap((file) => violations(file, readFileSync(file, 'utf8')))).toEqual([]);
  });
});
