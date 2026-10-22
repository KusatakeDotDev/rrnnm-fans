import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ScheduleCard from '../../src/components/ScheduleCard.tsx';
import { OFFICIAL } from '../../src/data/official';
import { WATCH_URL } from '../../src/data/schedule';

/** 予定のカード（ADR-0004「サムネイル表示の可否についての判断」）。開発とプレビューのビルドでは、予定を取れないことがある。 */
const render = (schedule: Parameters<typeof ScheduleCard>[0]['schedule']) =>
  renderToStaticMarkup(createElement(ScheduleCard, { schedule }));

const attr = (html: string, tag: string, name: string) =>
  new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`).exec(html)?.[1];

/** 出典の行の、タイトルのリンクより前の文字と、そのすぐ後ろに来るリンクの開始タグ。 */
const sourceLine = (html: string) => {
  const match = /<span\b[^>]*\sdata-schedule-source=""[^>]*>([^<]*)(<a\b[^>]*>)/.exec(html);
  return { label: match?.[1], link: match?.[2] ?? '' };
};

describe('予定のカード', () => {
  it('予定を取れなかったら、公式チャンネルを新しいタブで開くリンクだけにし、画像を出さない', () => {
    const html = render(null);
    expect(html).toMatch(/^<div\b[^>]*><a\b[^>]*>[\s\S]*<\/a><\/div>$/);
    expect(attr(html, 'a', 'href')).toBe(OFFICIAL.youtube);
    expect(attr(html, 'a', 'target')).toBe('_blank');
    expect(attr(html, 'a', 'rel')).toBe('noopener noreferrer');
    expect(html).not.toContain('<img');
  });

  it('予定を取れたら、受け取ったサムネイルをその大きさで出し、視聴ページへリンクする', () => {
    const html = render({
      oembed: { title: '固定データの配信スケジュール', author_name: 'テスト用チャンネル', provider_name: 'YouTube' },
      thumbnail: { url: 'https://i.ytimg.com/vi/fixture/hqdefault.jpg', width: 480, height: 360 },
    });
    expect(attr(html, 'img', 'src')).toBe('https://i.ytimg.com/vi/fixture/hqdefault.jpg');
    expect(attr(html, 'img', 'width')).toBe('480');
    expect(attr(html, 'img', 'height')).toBe('360');
    expect(attr(html, 'a', 'href')).toBe(WATCH_URL);
    expect(html).not.toContain(OFFICIAL.youtube);
  });

  it('作者名が取れなかったら、出典の行は作者名だけを除いた形にし、すぐ後ろに視聴ページへのタイトルのリンクを置く', () => {
    const author = 'テスト用チャンネル';
    const thumbnail = { url: 'https://i.ytimg.com/vi/fixture/hqdefault.jpg', width: 480, height: 360 };
    const title = '固定データの配信スケジュール';
    const withAuthor = sourceLine(render({ oembed: { title, author_name: author, provider_name: 'YouTube' }, thumbnail }));
    const html = render({ oembed: { title, provider_name: 'YouTube' }, thumbnail });
    const withoutAuthor = sourceLine(html);

    expect(withAuthor.label).toContain(author);
    expect(withoutAuthor.label, '作者名が無くても、タイトルのリンクの前に出典を示す文字がある').toMatch(/\S/);
    expect(withoutAuthor.label?.trim()).toBe(withAuthor.label?.replace(author, '').trim());
    expect(html).not.toContain('undefined');
    expect(attr(withoutAuthor.link, 'a', 'href')).toBe(WATCH_URL);
    expect(attr(withoutAuthor.link, 'a', 'target')).toBe('_blank');
    expect(attr(withoutAuthor.link, 'a', 'rel')).toBe('noopener noreferrer');
  });
});
