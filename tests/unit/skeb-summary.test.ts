import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import * as fs from 'node:fs/promises';
vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>() }));
import { run } from '../../scripts/skeb-summary';
import {
  inputHash, readDescription, restoreState, resultHash, tasks, validateInput, validateResult, validateState,
} from '../../scripts/skeb-summary-core';
import { object, hash, validateQuote, validateSummary, validateSummaryData } from '../../src/lib/skeb-summary';

const url = 'https://skeb.jp/@rurino_nemo/works/1';
const other = 'https://skeb.jp/@rurino_nemo/works/2';
const urls = [url, other];
const source = 'テスト用の架空の依頼です。朝の挨拶を希望します。';
const quote = { text: 'これは架空の作品のセリフです。', url, retrieved: '2026-10-13' };
const summary = { heading: '朝の挨拶の依頼', quote, tags: ['挨拶'] };
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'skeb-test-'));
  roots.push(root);
  const dir = resolve(root, '.local/skeb');
  await mkdir(dir, { recursive: true });
  const put = async (file: string, value: unknown) => writeFile(resolve(dir, file), JSON.stringify(value));
  await put('inputs.json', [{ url, format: 'metadata', file: 'input.json' }]);
  await put('input.json', { url, description: source, quote, sourceTags: ['朝', '挨拶', '明るい挨拶'] });
  const get = async (file: string) => JSON.parse(await readFile(resolve(dir, file), 'utf8'));
  const published = async () => JSON.parse(await readFile(resolve(root, 'src/data/skeb-summaries.json'), 'utf8'));
  const command = (...args: string[]) => run(root, urls, args);
  return { root, dir, put, get, published, command };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('local Skeb summary workflow (synthetic requests only)', () => {
  it.each(['skeb-summaries.json', 'state.json', 'tasks.json', 'review.json'])('finishes interrupted updates before publishing old approvals: %s', async (target) => {
    const f = await fixture();
    await f.command('prepare');
    const [task] = await f.get('tasks.json');
    const result = { url, inputHash: task.inputHash, status: 'generated' as const, summary };
    await f.put('results.json', [result]);
    await f.command('apply');
    await f.command('approve', url, resultHash(result));
    await f.put('input.json', { url, description: '架空の変更後の依頼。夕方の挨拶。' });
    const rename = fs.rename;
    const failure = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith(target)) throw new Error('synthetic interrupted write');
      return rename(from, to);
    });
    try { await expect(f.command('prepare')).rejects.toThrow('synthetic interrupted write'); }
    finally { failure.mockRestore(); }
    expect((await f.get('update.json')).approvals).toEqual([]);
    await f.command('publish');
    expect((await f.published()).works[0].status).toBe('pending');
    expect((await f.get('state.json')).approvals).toEqual([]);
    expect(await f.get('tasks.json')).toHaveLength(1);
    await expect(readFile(resolve(f.dir, 'update.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a corrupt update journal for inspection and refuses stale publication', async () => {
    const f = await fixture();
    await f.command('prepare');
    await f.put('update.json', { invalid: true });
    await expect(f.command('publish')).rejects.toThrow();
    expect((await f.published()).works.every((w: { status: string }) => w.status === 'missing')).toBe(true);
    expect(await f.get('update.json')).toEqual({ invalid: true });
  });
  it.each([
    '<script>const template = "<body>";</script>',
    '<script>const template = "</head>";</script>',
    '<!-- <body> -->',
    '<!-- </head> -->',
    '<style>.test::after { content: "<body>"; }</style>',
    '<style>.test::after { content: "</head>"; }</style>',
  ])('ignores head boundary strings inside non-metadata HTML: %s', (prefix) => {
    expect(readDescription(`<head>${prefix}<meta property="og:description" content="${source}"></head><body><meta property="og:description" content="outside head">`)).toBe(source);
  });

  it('requires an exact review receipt before publishing and keeps source text private', async () => {
    const f = await fixture();
    expect(await f.command('prepare')).toEqual({ tasks: 1, generated: 0, approved: 0 });
    const [task] = await f.get('tasks.json');
    expect(task.description).toBe(source);
    const result = { url, inputHash: task.inputHash, status: 'generated', summary };
    await f.put('results.json', [result]);
    await f.command('apply');
    expect((await f.published()).works[0]).toEqual({ url, inputHash: task.inputHash, status: 'awaiting-review' });
    await expect(f.command('approve', url, '0'.repeat(64))).rejects.toThrow('receipt');
    const [review] = await f.get('review.json');
    expect(review.sourceTags).toEqual(['朝', '挨拶', '明るい挨拶']);
    await f.command('approve', url, review.resultHash);
    const data = await f.published();
    expect(data.works[0].summary).toEqual(summary);
    expect(data.works[1].status).toBe('missing');
    expect(JSON.stringify(data)).not.toContain(source);
    expect(JSON.stringify(review)).not.toContain(source);
    // An agent may rewrite JSON with a different key order without changing its meaning.
    await f.put('results.json', [{ summary: { tags: summary.tags, quote: { retrieved: quote.retrieved, url: quote.url, text: quote.text }, heading: summary.heading }, status: 'generated', inputHash: task.inputHash, url }]);
    await f.command('apply');
    expect((await f.published()).works[0].status).toBe('approved');
    const before = (await stat(resolve(f.root, 'src/data/skeb-summaries.json'))).mtimeMs;
    await f.command('prepare');
    await f.command('apply');
    await f.command('publish');
    expect((await stat(resolve(f.root, 'src/data/skeb-summaries.json'))).mtimeMs).toBe(before);
    expect(await f.get('tasks.json')).toEqual([]);
  });

  it('invalidates approvals for changed input, rejects stale results, and removes deleted inputs', async () => {
    const f = await fixture();
    await f.command('prepare');
    const [task] = await f.get('tasks.json');
    const result = { url, inputHash: task.inputHash, status: 'generated' as const, summary };
    await f.put('results.json', [result]);
    await f.command('apply');
    await f.command('approve', url, resultHash(result));
    await f.put('input.json', { url, description: '架空の別の依頼。夕方の挨拶。' });
    await f.command('prepare');
    expect((await f.published()).works[0].status).toBe('pending');
    expect((await f.get('tasks.json'))[0].inputHash).not.toBe(task.inputHash);
    await expect(f.command('apply')).rejects.toThrow('stale');
    await f.put('inputs.json', []);
    await f.command('prepare');
    expect((await f.published()).works.every((w: { status: string }) => w.status === 'missing')).toBe(true);
  });

  it('recovers unchanged published approvals on a new checkout without republishing source text', async () => {
    const f = await fixture();
    await f.command('prepare');
    const [task] = await f.get('tasks.json');
    const result = { url, inputHash: task.inputHash, status: 'generated' as const, summary };
    await f.put('results.json', [result]);
    await f.command('apply');
    await f.command('approve', url, resultHash(result));
    const before = await f.published();
    await rm(resolve(f.dir, 'state.json'));
    for (const command of ['review', 'publish']) {
      await expect(f.command(command)).rejects.toThrow('Private state is missing');
      expect(await f.published()).toEqual(before);
    }
    await f.put('inputs.json', []);
    await expect(f.command('prepare')).rejects.toThrow('Recovery requires local inputs');
    expect(await f.published()).toEqual(before);
    await f.put('inputs.json', [{ url, format: 'metadata', file: 'input.json' }]);
    expect(await f.command('prepare')).toEqual({ tasks: 0, generated: 1, approved: 1 });
    expect(await f.published()).toEqual(before);
    await rm(resolve(f.dir, 'state.json'));
    await f.put('input.json', { url, description: '架空の変更された依頼。' });
    expect(await f.command('prepare')).toEqual({ tasks: 1, generated: 0, approved: 0 });
    expect((await f.published()).works[0].status).toBe('pending');
  });

  it('recovers unchanged failures without automatically retrying them', async () => {
    const f = await fixture();
    await f.command('prepare');
    const [task] = await f.get('tasks.json');
    await f.put('results.json', [{ url, inputHash: task.inputHash, status: 'failed' }]);
    await f.command('apply');
    await rm(resolve(f.dir, 'state.json'));
    expect(await f.command('prepare')).toEqual({ tasks: 0, generated: 0, approved: 0 });
    expect((await f.published()).works[0].status).toBe('failed');
  });

  it('retains failures without generating repeated tasks until explicitly retried', async () => {
    const f = await fixture();
    await f.command('prepare');
    const [task] = await f.get('tasks.json');
    await f.put('results.json', [{ url, inputHash: task.inputHash, status: 'failed' }]);
    await f.command('apply');
    await f.command('prepare');
    expect(await f.get('tasks.json')).toEqual([]);
    expect((await f.published()).works[0].status).toBe('failed');
    await f.command('retry', url);
    expect(await f.get('tasks.json')).toHaveLength(1);
    expect((await f.published()).works[0].status).toBe('pending');
  });

  it('rejects source paths outside the private directory and falls back after invalid input', async () => {
    const f = await fixture();
    await f.command('prepare');
    await writeFile(resolve(f.root, 'outside.json'), JSON.stringify({ url, description: source, quote, sourceTags: ['朝', '挨拶', '明るい挨拶'] }));
    await f.put('inputs.json', [{ url, format: 'metadata', file: '../../outside.json' }]);
    await expect(f.command('prepare')).rejects.toThrow('inside');
    expect((await f.published()).works[0].status).toBe('missing');
    expect(await f.get('tasks.json')).toEqual([]);
  });

  it.each(['state.json', 'input.json'])('clears approved output and derived files after corrupt %s', async (file) => {
    const f = await fixture();
    await f.command('prepare');
    const [task] = await f.get('tasks.json');
    const result = { url, inputHash: task.inputHash, status: 'generated' as const, summary };
    await f.put('results.json', [result]);
    await f.command('apply');
    await f.command('approve', url, resultHash(result));
    expect((await f.published()).works[0].status).toBe('approved');
    const broken = '{broken JSON';
    await writeFile(resolve(f.dir, file), broken);
    await expect(f.command('prepare')).rejects.toThrow();
    expect((await f.published()).works[0].status).toBe('missing');
    expect(await f.get('tasks.json')).toEqual([]);
    expect(await f.get('review.json')).toEqual([]);
    if (file === 'state.json') expect(await readFile(resolve(f.dir, file), 'utf8')).toBe(broken);
  });

  it('does not partially apply a batch or publish extra fields or duplicate works', async () => {
    const f = await fixture();
    await f.command('prepare');
    const [task] = await f.get('tasks.json');
    const result = { url, inputHash: task.inputHash, status: 'generated', summary };
    await f.put('results.json', [result, { ...result, url: other }]);
    await expect(f.command('apply')).rejects.toThrow();
    expect((await f.get('state.json')).results).toEqual([]);
    await f.put('results.json', [result, result]);
    await expect(f.command('apply')).rejects.toThrow('Duplicate');
    await f.put('results.json', [{ ...result, description: source }]);
    await expect(f.command('apply')).rejects.toThrow('fields');
  });

  it('revokes approval when the generated text changes', async () => {
    const f = await fixture();
    await f.command('prepare');
    const [task] = await f.get('tasks.json');
    const result = { url, inputHash: task.inputHash, status: 'generated' as const, summary };
    await f.put('results.json', [result]);
    await f.command('apply');
    await f.command('approve', url, resultHash(result));
    await f.put('results.json', [{ ...result, summary: { ...summary, heading: '挨拶の希望' } }]);
    await f.command('apply');
    expect((await f.published()).works[0].status).toBe('awaiting-review');
    expect((await f.published()).works[0]).not.toHaveProperty('summary');
  });

  it('removes saved state for delisted URLs while retaining other approved works', async () => {
    const f = await fixture();
    await f.put('input-2.json', { url: other, description: '架空の依頼です。夜の挨拶を希望します。', quote: { ...quote, url: other } });
    await f.put('inputs.json', [{ url, format: 'metadata', file: 'input.json' }, { url: other, format: 'metadata', file: 'input-2.json' }]);
    await f.command('prepare');
    const results = (await f.get('tasks.json')).map((task: { url: string; inputHash: string }) => ({
      url: task.url, inputHash: task.inputHash, status: 'generated' as const, summary: { ...summary, quote: { ...quote, url: task.url } },
    }));
    await f.put('results.json', results);
    await f.command('apply');
    for (const result of results) await f.command('approve', result.url, resultHash(result));
    await f.put('inputs.json', [{ url: other, format: 'metadata', file: 'input-2.json' }]);
    await run(f.root, [other], ['prepare']);
    expect((await f.published()).works).toEqual([{ url: other, inputHash: results[1].inputHash, status: 'approved', summary: { ...summary, quote: { ...quote, url: other } } }]);
    expect((await f.get('state.json')).inputs).toHaveLength(1);
    expect((await f.get('state.json')).approvals).toHaveLength(1);
  });

  it('supports local HTML and serializes simultaneous commands', async () => {
    const f = await fixture();
    await f.put('inputs.json', [{ url, format: 'html', file: 'input.html' }]);
    await writeFile(resolve(f.dir, 'input.html'), `<meta content='${source}' property='og:description'>`);
    await f.command('prepare');
    expect((await f.get('tasks.json'))[0].description).toBe(source);
    await mkdir(resolve(f.dir, 'lock'));
    await expect(f.command('prepare')).rejects.toThrow('running');
  });
});

describe('input and publication contracts', () => {
  it('preserves provided provenance and rejects a result that presents it as verified', () => {
    const provided = { ...quote, provenance: 'user-provided' as const };
    const input = { url, description: source, quote: provided };
    const result = { url, inputHash: inputHash(input), status: 'generated', summary: { ...summary, quote: provided } };
    expect(validateResult(result, [input])).toEqual(result);
    expect(inputHash(input)).not.toBe(inputHash({ ...input, quote }));
    expect(() => validateResult({ ...result, summary }, [input])).toThrow('match supplied');
    for (const provenance of ['verified', '', null, true]) {
      expect(() => validateSummary({ ...summary, quote: { ...quote, provenance } })).toThrow('Invalid quote provenance');
    }
  });
  it('rejects future confirmation dates and accepts today at the UTC boundary', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));
      expect(validateSummary(summary)).toEqual(summary);
      expect(() => validateSummary({ ...summary, quote: { ...quote, retrieved: '2026-10-14' } })).toThrow('Invalid quote date');
    } finally { vi.useRealTimers(); }
  });
  it('rejects invented or request-derived quotes and preserves original tags through approval', async () => {
    const f = await fixture();
    await f.command('prepare');
    const [task] = await f.get('tasks.json');
    expect(task.sourceTags).toEqual(['朝', '挨拶', '明るい挨拶']);
    const result = { url, inputHash: task.inputHash, status: 'generated' as const, summary };
    expect(() => validateResult({ ...result, summary: { ...summary, quote: { ...quote, text: source } } }, [task])).toThrow('match supplied');
    const input = { url, description: source };
    expect(() => validateResult({ ...result, inputHash: inputHash(input) }, [input])).toThrow('match supplied');
    await f.put('results.json', [result]);
    await f.command('apply');
    expect((await f.get('review.json'))[0].sourceTags).toEqual(task.sourceTags);
    await f.command('approve', url, resultHash(result));
    expect((await f.get('state.json')).inputs[0].sourceTags).toEqual(task.sourceTags);
    await f.put('input.json', { url, description: source, sourceTags: task.sourceTags, quote: { ...quote, text: '差し替えた架空のセリフ。' } });
    await f.command('prepare');
    expect((await f.published()).works[0].status).toBe('pending');
  });

  it('rejects mismatched sources, invalid dates and old publication schemas', () => {
    const row = { url, inputHash: 'a'.repeat(64), status: 'approved', summary };
    for (const badQuote of [{ ...quote, url: other }, { ...quote, retrieved: '2026-02-30' }, { ...quote, retrieved: 'invalid' }]) {
      expect(() => validateSummaryData({ version: 2, works: [{ ...row, summary: { ...summary, quote: badQuote } }] }, [url])).toThrow();
    }
    expect(() => validateSummaryData({ version: 1, works: [row] }, [url])).toThrow();
    expect(() => validateSummary({ ...summary, text: source })).toThrow('fields');
  });

  it('rejects public data with fewer rows than listed works', () => {
    const missing = { url, inputHash: null, status: 'missing' };
    expect(validateSummaryData({ version: 2, works: [missing, { ...missing, url: other }] }, urls).works).toHaveLength(2);
    expect(() => validateSummaryData({ version: 2, works: [missing] }, urls)).toThrow('Invalid summary data');
  });

  it.each([
    ['another host', 'https://example.com/@rurino_nemo/works/1'],
    ["another creator's work", 'https://skeb.jp/@someone/works/1'],
    ['a prefixed URL', `x${url}`],
    ['a suffixed URL', `${url}x`],
    ['a non-string value', { toString: (): string => url }],
  ])('rejects a quote source that is not a Skeb work page (%s)', (_, value) => {
    expect(() => validateSummary({ ...summary, quote: { ...quote, url: value } })).toThrow('Invalid quote source');
  });

  it.each([
    ['array', ['pending']],
    ['empty array', []],
    ['object', { status: 'pending' }],
    ['coercible object', { toString: () => 'pending' }],
    ['null', null],
    ['undefined', undefined],
    ['number', 1],
    ['boolean', true],
  ])('rejects a non-string status (%s)', (_, status) => {
    expect(() => validateSummaryData({
      version: 2,
      works: [{ url, inputHash: 'a'.repeat(64), status }],
    }, [url])).toThrow('Invalid status');
  });

  it('rejects malformed types, hashes, lengths and tags at the public boundary', () => {
    for (const value of [null, [], 0, 1, true, '', 'value', undefined]) {
      expect(() => object(value, [])).toThrow('Invalid object fields');
    }
    for (const value of [null, 1, 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'A'.repeat(64)]) {
      expect(() => hash(value)).toThrow('Invalid hash');
    }
    hash('abcdef0123456789'.repeat(4));
    for (const heading of ['x'.repeat(33), ' x', 'x ', ' ', 1, null]) {
      expect(() => validateSummary({ ...summary, heading })).toThrow('Invalid summary text');
    }
    expect(validateSummary({ heading: 'x'.repeat(32), quote: { ...quote, text: 'x'.repeat(80) }, tags: ['x'.repeat(12), 'b', 'c'] }).tags).toHaveLength(3);
    expect(validateSummary({ ...summary, tags: [] }).tags).toEqual([]);
    for (const tags of [null, 'tag', ['a', 'b', 'c', 'd']]) {
      expect(() => validateSummary({ ...summary, tags })).toThrow('Invalid tags');
    }
    for (const tags of [['x'.repeat(13)], [''], [null]]) {
      expect(() => validateSummary({ ...summary, tags })).toThrow('Invalid summary text');
    }
    expect(() => validateSummary({ ...summary, tags: ['a', 'a'] })).toThrow('Duplicate tags');
    const row = { url, inputHash: 'a'.repeat(64), status: 'pending' };
    expect(() => validateSummaryData({ version: 2, works: [row, row] }, urls)).toThrow('Invalid work URL');
    expect(() => validateSummaryData({ version: 1, works: [] }, urls)).toThrow('Invalid summary data');
    expect(() => validateSummaryData({ version: 2, works: 'invalid' }, urls)).toThrow('Invalid summary data');
    expect(() => validateSummaryData({ version: 2, works: [{ ...row, status: 'missing' }] }, [url])).toThrow('Missing input');
    expect(() => validateSummaryData({ version: 2, works: [{ ...row, status: 'unknown' }] }, [url])).toThrow('Invalid status');
    expect(() => validateSummaryData({ version: 2, works: [{ ...row, summary }] }, [url])).toThrow('Unapproved summary');
    expect(() => validateSummaryData({ version: 2, works: [{ ...row, status: 'approved', summary: { ...summary, quote: { ...quote, text: '' } } }] }, [url])).toThrow('Invalid summary text');
  });
  it('decodes attributes once and ignores comments and scripts', () => {
    expect(readDescription(`<!-- <meta property="og:description" content="bad"> -->
      <script>"<meta property='og:description' content='bad'>"</script>
      <META CONTENT='A &amp; B &quot;C&quot; &#x1F600; &amp;lt;' PROPERTY="og:description">`)).toBe('A & B "C" 😀 &lt;');
    expect(() => readDescription('<meta property="og:description" content="&copy;">')).toThrow('entity');
    expect(() => readDescription('<meta property="og:description" content="x"><meta property="og:description" content="y">')).toThrow('one');
    expect(() => readDescription('<meta property="og:description" content="">')).toThrow('nonempty');
  });
  it('rejects malformed public data and unsafe or oversized text', () => {
    const input = { url, description: source, quote, sourceTags: ['朝', '挨拶', '明るい挨拶'] };
    const result = { url, inputHash: inputHash(input), status: 'generated', summary };
    for (const text of ['', 'x'.repeat(81), '<script>', 'hello\nworld', 'a\u202eb']) {
      expect(() => validateResult({ ...result, summary: { ...summary, quote: { ...quote, text } } }, [input])).toThrow();
    }
    for (const data of [
      { version: 2, works: [{ url, inputHash: inputHash(input), status: 'pending', summary }] },
      { version: 2, works: [{ url, inputHash: null, status: 'approved', summary }] },
      { version: 2, works: [{ url: 'https://example.com', inputHash: null, status: 'missing' }] },
      { version: 1, works: [] },
    ]) expect(() => validateSummaryData(data, [url])).toThrow();
  });
});

describe('公開する要約の形を確かめる', () => {
  it('文字列にすると形が合う値でも、文字列でないハッシュは弾く', () => {
    for (const value of [['a'.repeat(64)], { toString: () => 'a'.repeat(64) }]) {
      expect(() => hash(value)).toThrow('Invalid hash');
    }
  });

  it('取得日は YYYY-MM-DD の文字列だけを受け付ける（年が6桁の形や、文字列でない値は弾く）', () => {
    for (const retrieved of ['-000001-01', '+002026-10', 20261013, null, ['2026-10-13']]) {
      expect(() => validateQuote({ ...quote, retrieved })).toThrow('Invalid quote date');
    }
  });

  it('承認した要約の引用の出典が、その作品と違えば弾く', () => {
    const row = { url, inputHash: 'a'.repeat(64), status: 'approved', summary: { ...summary, quote: { ...quote, url: other } } };
    expect(() => validateSummaryData({ version: 2, works: [row] }, [url])).toThrow('Quote source mismatch');
  });

  it('文字列でない作品の URL は弾く', () => {
    const row = { url: [url], inputHash: null, status: 'missing' };
    expect(() => validateSummaryData({ version: 2, works: [row] }, [url])).toThrow('Invalid work URL');
  });
});

describe('作品の入力を確かめる', () => {
  const ok = { url, description: source };

  it('一覧に無い URL と、文字列でない URL は弾く', () => {
    for (const bad of ['https://skeb.jp/@rurino_nemo/works/3', [url], 1]) {
      expect(() => validateInput({ ...ok, url: bad }, urls)).toThrow('Invalid input');
    }
  });

  it('説明が文字列でない・空白だけ・20000 文字を超えるなら弾き、20000 文字ちょうどは通す', () => {
    for (const description of [5, null, ' \n ', 'x'.repeat(20001)]) {
      expect(() => validateInput({ ...ok, description }, urls)).toThrow('Invalid input');
    }
    expect(validateInput({ ...ok, description: 'x'.repeat(20000) }, urls).description).toHaveLength(20000);
  });

  it('説明の改行を \\n にそろえ、前後の空白を落とす', () => {
    expect(validateInput({ ...ok, description: ' 一行目\r\n二行目\r三行目\n ' }, urls).description).toBe('一行目\n二行目\n三行目');
  });

  it('タグを省けば空のタグとして読み、空のタグを書いた入力と同じハッシュになる', () => {
    expect(validateInput(ok, urls).sourceTags).toEqual([]);
    expect(inputHash(ok)).toBe(inputHash({ ...ok, sourceTags: [] }));
  });

  it('タグの形が合わなければ弾き、50 個・1つ 100 文字までは通す', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `タグ${i}`);
    for (const sourceTags of ['朝', many(51), [1], [''], ['  '], ['x'.repeat(101)], ['a​b'], ['a\u0007b'], ['<b>']]) {
      expect(() => validateInput({ ...ok, sourceTags }, urls)).toThrow('Invalid source tags');
    }
    expect(validateInput({ ...ok, sourceTags: many(50) }, urls).sourceTags).toEqual(many(50));
    expect(validateInput({ ...ok, sourceTags: ['x'.repeat(100)] }, urls).sourceTags).toEqual(['x'.repeat(100)]);
  });

  it('引用の出典がその作品と違えば弾く', () => {
    expect(() => validateInput({ ...ok, quote: { ...quote, url: other } }, urls)).toThrow('Quote source mismatch');
  });
});

describe('作品のページの HTML から説明文を読む', () => {
  const read = (content: string) => readDescription(`<meta property="og:description" content="${content}">`);

  it('10進・16進（x の大小を問わない）・名前の文字参照を読む', () => {
    expect(read('&#65;&#x41;&#X41;&apos;&lt;&gt;a&nbsp;b')).toBe("AAA'<>a b");
  });

  it('文字の無い番号とサロゲートを指す文字参照は弾き、その手前・後ろと U+10FFFF は読む', () => {
    for (const entity of ['&#0;', '&#x110000;', '&#xD800;', '&#xDFFF;']) {
      expect(() => read(`a${entity}`)).toThrow('Invalid HTML entity');
    }
    expect(read('&#xD7FF;&#xE000;&#x10FFFF;')).toBe('퟿\u{10FFFF}');
  });

  it('属性の付いた script と、閉じタグに空白のある style の中の meta は読まない', () => {
    const bad = `"<meta property='og:description' content='bad'>"`;
    const page = `<meta property="og:description" content="${source}">`;
    expect(readDescription(`<script type="application/ld+json">${bad}</script>${page}`)).toBe(source);
    expect(readDescription(`<style>${bad}</style >${page}`)).toBe(source);
  });

  it('body の無いページでも、</head> より後ろの meta は読まない', () => {
    for (const end of ['</head>', '</head >']) {
      expect(readDescription(`<meta property="og:description" content="${source}">${end}<meta property="og:description" content="outside">`)).toBe(source);
    }
  });

  it('= の前後に空白のある属性と、引用符の無い属性も読む', () => {
    expect(readDescription(`<meta property = "og:description" content = '${source}'>`)).toBe(source);
    expect(readDescription('<meta property=og:description content=unquoted>')).toBe('unquoted');
  });

  it('同じ属性が2つある meta は弾く', () => {
    expect(() => readDescription(`<meta property="og:description" property="og:title" content="${source}">`)).toThrow('Duplicate meta attribute');
  });

  it('og:description でない meta は数えない', () => {
    expect(readDescription(`<meta charset="utf-8"><meta name="description" content="別の説明"><meta property="og:description" content="${source}">`)).toBe(source);
  });

  it('content の無い・空白だけの og:description は弾く', () => {
    for (const html of ['<meta property="og:description">', '<meta property="og:description" content="  ">']) {
      expect(() => readDescription(html)).toThrow('Expected one nonempty og:description');
    }
  });
});

describe('生成した結果と保存した状態を確かめる', () => {
  const input = { url, description: source, sourceTags: [], quote };
  // ハッシュは it の中で作る。describe の中で投げたミュータントは、Stryker が倒したと数えない。
  const fixture = () => {
    const result = { url, inputHash: inputHash(input), status: 'generated' as const, summary };
    const failed = { url, inputHash: inputHash(input), status: 'failed' as const };
    return { result, failed, state: { version: 2, inputs: [input], results: [result], approvals: [resultHash(result)] } };
  };

  it('失敗の結果も、要約なしでハッシュにする', () => {
    expect(resultHash(fixture().failed)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('結果のハッシュの形が合わなければ、古い結果ではなくハッシュの誤りとして弾く', () => {
    expect(() => validateResult({ ...fixture().result, inputHash: 'x' }, [input])).toThrow('Invalid hash');
  });

  it('失敗の結果は要約を持てず、知らない状態の結果は弾く', () => {
    const { failed } = fixture();
    expect(validateResult(failed, [input])).toEqual(failed);
    for (const value of [{ ...failed, summary }, { ...failed, status: 'unknown' }]) {
      expect(() => validateResult(value, [input])).toThrow('Invalid result status');
    }
  });

  it('形の合う状態はそのまま読み、形の合わない状態は弾く', () => {
    const { state } = fixture();
    expect(validateState(state, urls)).toEqual(state);
    for (const bad of [{ ...state, version: 1 }, { ...state, inputs: {} }, { ...state, results: {} }, { ...state, approvals: 'x' }]) {
      expect(() => validateState(bad, urls)).toThrow('Invalid state');
    }
  });

  it('同じ作品の入力か結果が2つあれば弾く', () => {
    const { result, state } = fixture();
    expect(() => validateState({ ...state, inputs: [input, input] }, urls)).toThrow('Duplicate work');
    expect(() => validateState({ ...state, results: [result, result] }, urls)).toThrow('Duplicate work');
  });

  it('承認は、形の合うハッシュで、今ある生成した結果のどれかを指す', () => {
    const { failed, state } = fixture();
    expect(() => validateState({ ...state, approvals: ['x'] }, urls)).toThrow('Invalid hash');
    expect(() => validateState({ ...state, approvals: ['b'.repeat(64)] }, urls)).toThrow('Stale approval');
    expect(() => validateState({ ...state, results: [failed], approvals: [resultHash(failed)] }, urls)).toThrow('Stale approval');
  });

  it('保存した URL が Skeb の作品のページの形でなければ弾く', () => {
    const saved = (value: unknown) => ({ version: 2, inputs: [{ ...input, url: value }], results: [], approvals: [] });
    for (const bad of [[url], `x${url}`, `${url}x`, 'https://skeb.jp/@someone/works/1', 'https://skeb.jp/@rurino_nemo/works/0']) {
      expect(() => restoreState(saved(bad), urls)).toThrow('Invalid saved URL');
    }
    expect(() => restoreState({ ...saved(url), inputs: {} }, urls)).toThrow('Invalid state inputs');
  });

  it('今の一覧から外れた作品の保存分は落とし、一覧にある作品は残す', () => {
    const delisted = 'https://skeb.jp/@rurino_nemo/works/10';
    const inputs = [input, { ...input, url: delisted, quote: { ...quote, url: delisted } }];
    expect(restoreState({ version: 2, inputs, results: [], approvals: [] }, [url]).inputs.map((row) => row.url)).toEqual([url]);
  });

  it('結果の無い作品だけを、生成の作業に出す', () => {
    const second = { url: other, description: '架空の別の依頼です。', sourceTags: [] };
    expect(tasks({ version: 2, inputs: [input, second], results: [fixture().result], approvals: [] }).map((task) => task.url)).toEqual([other]);
  });
});
