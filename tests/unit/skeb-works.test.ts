import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SKEB_WORKS } from '../../src/data/skeb';
import SkebWorks from '../../src/unreleased/_parts/SkebWorks.tsx';

// 公開 JSON の実データは全件が承認済みなので、公開しない状態・タグなし・cite の有無・エスケープの要る記号は合成データでしか通らない。
const QUOTE = '架空の「引用」&"セリフ"の表示テストです。'.repeat(3);
const STATUSES = ['approved', 'approved', 'pending', 'failed', 'awaiting-review'] as const;
const data = {
  version: 2,
  works: SKEB_WORKS.map((work, index) => ({
    url: work.url,
    inputHash: index < STATUSES.length ? 'a'.repeat(64) : null,
    status: STATUSES[index] ?? 'missing',
    ...(index < 2
      ? {
          summary: {
            heading: index === 0 ? '合成データの見出し' : 'タグなしの合成見出し',
            quote: { text: QUOTE, url: work.url, retrieved: '2026-10-13', ...(index === 0 ? { provenance: 'user-provided' } : {}) },
            tags: index === 0 ? ['合成タグ', '表示確認'] : [],
          },
        }
      : {}),
  })),
};

const html = renderToStaticMarkup(createElement(SkebWorks, { works: SKEB_WORKS, data }));
const [, ...cardChunks] = html.split(/(?=<li\b[^>]*\sdata-skeb-work=")/);
const footer = html.slice(html.lastIndexOf('<footer'));
const cards = cardChunks.map((chunk) => chunk.split('</ul><footer')[0]!);

const decode = (text: string) =>
  text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const textOf = (markup: string) => decode(markup.replace(/<[^>]*>/g, ''));
const linksOf = (card: string) =>
  [...card.matchAll(/<a\b([^>]*)>/g)].map(([, attrs]) =>
    Object.fromEntries(['href', 'target', 'rel'].map((name) => [name, new RegExp(`\\s${name}="([^"]*)"`).exec(attrs!)?.[1]])),
  );
const quoteOf = (card: string) => /<blockquote\b([^>]*)>([\s\S]*?)<\/blockquote>/.exec(card);
const tagsOf = (card: string) => [...card.matchAll(/<li\b[^>]*\sdata-skeb-tag=[^>]*>([^<]*)<\/li>/g)].map(([, tag]) => decode(tag!));

describe('Skeb の作品一覧を合成データで描く', () => {
  it('17件とも番号順に並べ、どのカードにも作品の名前の見出しと、作品ページを新しいタブで開くリンクを置く', () => {
    expect(cards).toHaveLength(17);
    for (const [index, work] of SKEB_WORKS.entries()) {
      const card = cards[index]!;
      expect(card).toMatch(new RegExp(`^<li\\b[^>]*\\sdata-skeb-work="${index + 1}"`));
      expect(textOf(/<h3\b[^>]*>([\s\S]*?)<\/h3>/.exec(card)![1]!)).toBe(work.title);
      expect(linksOf(card)).toContainEqual({ href: work.url, target: '_blank', rel: 'noopener noreferrer' });
    }
  });

  it('pending・failed・awaiting-review・missing の作品は、セリフもお題もタグも出さず、リンクだけにする', () => {
    for (const [index, work] of SKEB_WORKS.entries()) {
      if (index < 2) continue;
      const card = cards[index]!;
      expect(card, work.title).not.toContain('data-skeb-summary');
      expect(card, work.title).not.toContain('<blockquote');
      expect(card, work.title).not.toContain('data-skeb-tag');
      expect(linksOf(card), work.title).toEqual(
        [work.deliveryPost?.url, work.youtube, work.url].flatMap((href) => (href ? [{ href, target: '_blank', rel: 'noopener noreferrer' }] : [])),
      );
    }
  });

  it('承認済みのセリフは、記号を変えずに文字としてだけ出し、提供資料のものには cite を付けない', () => {
    const [provided, verified] = [quoteOf(cards[0]!)!, quoteOf(cards[1]!)!];
    for (const [, , body] of [provided, verified]) {
      expect(body).not.toContain('<');
      expect(body).toContain('&amp;');
      expect(body).toContain('&quot;');
      expect(decode(body!)).toBe(QUOTE);
    }
    expect(provided[1]).not.toMatch(/\scite=/);
    expect(verified[1]).toMatch(new RegExp(`\\scite="${SKEB_WORKS[1]!.url}"`));
  });

  it('承認済みの作品にはお題を出し、タグはあるときだけ並べる', () => {
    expect(textOf(cards[0]!)).toContain('合成データの見出し');
    expect(tagsOf(cards[0]!)).toEqual(['合成タグ', '表示確認']);
    expect(textOf(cards[1]!)).toContain('タグなしの合成見出し');
    expect(cards[1]).not.toContain('<ul');
  });

  it('セリフを出すなら、一覧の下に出典の日付を提供元ごとに書き、リンクにしない', () => {
    expect(footer.match(/2026-10-13/g)).toHaveLength(2);
    expect(footer).not.toContain('<a');
  });
});
