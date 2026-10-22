import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCHEDULE_AUTHOR, SCHEDULE_VIDEO_ID } from '../../src/data/schedule';
import { fetchErrorReason, readMaxresHead, readScheduleOEmbed } from '../../src/lib/schedule-oembed';

/**
 * 予定のカード（ADR-0004「サムネイル表示の可否についての判断」）を、ビルドのときに取った応答から決める。
 * 失敗の理由は、ビルドのログに出す（Release が止まったときに、ログで見分けるため）。
 */

const OEMBED = {
  title: '固定データの配信スケジュール',
  author_name: 'テスト用チャンネル',
  provider_name: 'YouTube',
  thumbnail_url: `https://i.ytimg.com/vi/${SCHEDULE_VIDEO_ID}/hqdefault.jpg`,
  thumbnail_width: 480,
  thumbnail_height: 360,
};
/** これから始まるライブ（待機所）の oEmbed。題名は html の iframe にだけあり、作者名と画像は無い（RRNNM-106）。 */
const WAITING_ROOM = {
  type: 'video',
  version: '1.0',
  provider_name: 'YouTube',
  provider_url: 'https://www.youtube.com/',
  html: `<iframe width="200" height="150" src="https://www.youtube.com/embed/${SCHEDULE_VIDEO_ID}?feature=oembed" frameborder="0" allowfullscreen title="💠今週の配信スケジュール💠"></iframe>`,
};
const OK = { ok: true, status: 200 };

const reasonOf = (result: { ok: true } | { ok: false; reason: string }) => (result.ok ? null : result.reason);
const oembedOf = (json: unknown) => {
  const result = readScheduleOEmbed(OK, JSON.stringify(json));
  return result.ok ? result.oembed : null;
};
const withIframeTitle = (title: string) => ({ ...WAITING_ROOM, html: WAITING_ROOM.html.replace(/title="[^"]*"/, `title="${title}"`) });

describe('予定の oEmbed の応答', () => {
  it('項目が揃っていれば、題名・作者名・提供元・画像を読む', () => {
    expect(oembedOf(OEMBED)).toEqual({
      title: OEMBED.title,
      author_name: OEMBED.author_name,
      provider_name: 'YouTube',
      thumbnail: { url: OEMBED.thumbnail_url, width: 480, height: 360 },
    });
  });

  it('待機所の最小限の応答なら、題名を html の iframe から読み、作者名と画像は無しにする', () => {
    expect(oembedOf(WAITING_ROOM)).toEqual({
      title: '💠今週の配信スケジュール💠',
      author_name: undefined,
      provider_name: 'YouTube',
      thumbnail: undefined,
    });
  });

  it('title があれば、iframe の title より先に使う', () => {
    expect(oembedOf({ ...WAITING_ROOM, title: '項目の題名' })?.title).toBe('項目の題名');
  });

  it('iframe の title のエスケープを戻す', () => {
    expect(oembedOf(withIframeTitle('&lt;A&gt; &amp; &quot;B&quot; Don&#39;t &#128160;'))?.title).toBe(`<A> & "B" Don't 💠`);
  });

  it('作者名の前後の空白は落とす', () => {
    expect(oembedOf({ ...OEMBED, author_name: ' テスト用チャンネル\n' })?.author_name).toBe('テスト用チャンネル');
  });

  it.each([
    ['null', null],
    ['文字列でない', 1],
    ['空', ''],
    ['空白だけ', ' \t'],
  ])('作者名が %s なら、作者名は無しにする', (_, author) => {
    const oembed = oembedOf({ ...OEMBED, author_name: author });
    expect(oembed?.title).toBe(OEMBED.title);
    expect(oembed?.author_name).toBeUndefined();
  });

  it.each([
    ['thumbnail_url', 1],
    ['thumbnail_width', '480'],
    ['thumbnail_height', '360'],
  ])('%s の型が違えば、画像は無しにし、ほかは読む', (field, wrongType) => {
    const oembed = oembedOf({ ...OEMBED, [field]: wrongType });
    expect(oembed?.title).toBe(OEMBED.title);
    expect(oembed?.thumbnail).toBeUndefined();
  });

  it('HTTP の失敗なら使わず、状態を理由に出す', () => {
    expect(reasonOf(readScheduleOEmbed({ ok: false, status: 503 }, JSON.stringify(OEMBED)))).toContain('503');
  });

  it.each([
    ['本文が空', ''],
    ['本文が空白だけ', ' \n'],
    ['壊れた JSON', '{broken'],
    ['形の違う JSON', JSON.stringify({ error: 'Not Found' })],
    ['提供元が無い JSON', JSON.stringify({ ...OEMBED, provider_name: undefined })],
    ['題名も iframe も無い JSON', JSON.stringify({ ...WAITING_ROOM, html: undefined })],
    ['iframe に title が無い JSON', JSON.stringify({ ...WAITING_ROOM, html: '<iframe src="https://www.youtube.com/embed/x"></iframe>' })],
    ['iframe の title が空の JSON', JSON.stringify(withIframeTitle(''))],
    ['JSON の null', 'null'],
  ])('%s なら使わない', (_, body) => {
    expect(readScheduleOEmbed(OK, body).ok).toBe(false);
  });

  it('空の本文・壊れた JSON・形の違う JSON・HTTP の失敗は、理由で見分けられる', () => {
    const reasons = [
      readScheduleOEmbed(OK, ''),
      readScheduleOEmbed(OK, '{broken'),
      readScheduleOEmbed(OK, '{}'),
      readScheduleOEmbed({ ok: false, status: 503 }, ''),
    ].map(reasonOf);
    expect(reasons.every((reason) => typeof reason === 'string' && reason !== '')).toBe(true);
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it('空の本文と壊れた JSON は、パーサーのエラーを理由に出す', () => {
    expect(reasonOf(readScheduleOEmbed(OK, ''))).toMatch(/SyntaxError/);
    expect(reasonOf(readScheduleOEmbed(OK, '{broken'))).toMatch(/SyntaxError/);
  });
});

describe('高解像度のサムネイル（maxresdefault）の HEAD', () => {
  const head = (contentLength: string | null, status = 200) => ({ ok: status === 200, status, contentLength });

  it('10,001 バイトなら、高解像度を使う', () => {
    expect(readMaxresHead(head('10001'))).toEqual({ ok: true });
  });

  it('10,000 バイトまでは、YouTube の灰色のプレースホルダーとみなして使わない', () => {
    expect(readMaxresHead(head('10000')).ok).toBe(false);
    expect(readMaxresHead(head('1000')).ok).toBe(false);
  });

  it('長さが無ければ使わず、長さが無いことを理由に出す', () => {
    expect(reasonOf(readMaxresHead(head(null)))).toContain('content-length');
  });

  it('長さが数として読めなければ使わない', () => {
    expect(readMaxresHead(head('abc')).ok).toBe(false);
  });

  it('HEAD が失敗したら、長さがあっても使わず、状態を理由に出す', () => {
    expect(reasonOf(readMaxresHead(head('20000', 404)))).toContain('404');
  });

  it('HTTP の失敗・長さが無い・小さすぎるは、理由で見分けられる', () => {
    const reasons = [head('20000', 404), head(null), head('1000')].map((h) => reasonOf(readMaxresHead(h)));
    expect(reasons.every((reason) => typeof reason === 'string' && reason !== '')).toBe(true);
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(reasons[2]).toContain('1000');
  });
});

describe('取得が例外で終わったときの理由', () => {
  it('Node の fetch が cause に入れた、届かなかった理由も出す', () => {
    const error = new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND www.youtube.com') });
    const reason = fetchErrorReason(error);
    expect(reason).toContain('fetch failed');
    expect(reason).toContain('ENOTFOUND');
  });

  it('cause が無ければ、例外だけを出す', () => {
    expect(fetchErrorReason(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe(
      'TimeoutError: The operation was aborted due to timeout',
    );
  });

  it('Error でない値が投げられても、理由を作れる', () => {
    expect(fetchErrorReason(null)).toBe('null');
    expect(fetchErrorReason('止まった')).toBe('止まった');
  });
});

/**
 * src/data/schedule-oembed.ts は、取得の例外を握って予定なしに落とす。外すと、YouTube に届かないだけで
 * ビルドごと落ちる。モジュールが結果を持ち続けるので、テストごとに読み込み直す。
 */
describe('ビルドのときの予定の取得', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function getSchedule(fetchStub: (url: string, init?: RequestInit) => Promise<Response>) {
    vi.stubGlobal('fetch', vi.fn(fetchStub));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getSchedule: get } = await import('../../src/data/schedule-oembed');
    return { schedule: await get(), warn };
  }

  it('oEmbed の取得が例外で終わっても、ビルドを止めずに予定なしにし、理由をログに出す', async () => {
    const { schedule, warn } = await getSchedule(async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
    });
    expect(schedule).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('ECONNRESET');
  });

  it('高解像度の確かめが例外で終わっても、oEmbed の画像で予定を出し、理由をログに出す', async () => {
    const { schedule, warn } = await getSchedule(async (_url, init) => {
      if (init?.method === 'HEAD') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return Response.json(OEMBED);
    });
    expect(schedule?.thumbnail).toEqual({ url: OEMBED.thumbnail_url, width: 480, height: 360 });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('TimeoutError');
  });

  it('oEmbed が読めて高解像度もあれば、高解像度で予定を出し、ログには何も出さない', async () => {
    const { schedule, warn } = await getSchedule(async (_url, init) =>
      init?.method === 'HEAD' ? new Response(null, { headers: { 'content-length': '20000' } }) : Response.json(OEMBED),
    );
    expect(schedule).toEqual({
      oembed: { title: OEMBED.title, author_name: OEMBED.author_name, provider_name: OEMBED.provider_name },
      thumbnail: { url: `https://i.ytimg.com/vi/${SCHEDULE_VIDEO_ID}/maxresdefault.jpg`, width: 1280, height: 720 },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('待機所の最小限の応答でも、iframe の題名と決まった作者名で、高解像度の予定を出す', async () => {
    const { schedule, warn } = await getSchedule(async (_url, init) =>
      init?.method === 'HEAD' ? new Response(null, { headers: { 'content-length': '20000' } }) : Response.json(WAITING_ROOM),
    );
    expect(schedule).toEqual({
      oembed: { title: '💠今週の配信スケジュール💠', author_name: SCHEDULE_AUTHOR, provider_name: 'YouTube' },
      thumbnail: { url: `https://i.ytimg.com/vi/${SCHEDULE_VIDEO_ID}/maxresdefault.jpg`, width: 1280, height: 720 },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('高解像度が無く、oEmbed にも画像が無ければ、予定なしにし、理由をログに出す', async () => {
    const { schedule, warn } = await getSchedule(async (_url, init) =>
      init?.method === 'HEAD' ? new Response(null, { status: 404 }) : Response.json(WAITING_ROOM),
    );
    expect(schedule).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('404');
  });

  it('oEmbed が HTTP で失敗したら、予定なしにし、状態をログに出す', async () => {
    const { schedule, warn } = await getSchedule(async () => new Response('', { status: 503 }));
    expect(schedule).toBeNull();
    expect(String(warn.mock.calls[0]?.[0])).toContain('503');
  });
});
