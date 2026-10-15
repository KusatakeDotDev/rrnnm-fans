import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import * as fs from 'node:fs/promises';
vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>() }));
import { run } from '../../scripts/skeb-summary';
import { inputHash, readDescription, resultHash, validateResult } from '../../scripts/skeb-summary-core';
import { object, hash, validateSummary, validateSummaryData } from '../../src/lib/skeb-summary';

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
  const published = async () => JSON.parse(await readFile(resolve(root, 'src/content/skeb-summaries.json'), 'utf8'));
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
    const before = (await stat(resolve(f.root, 'src/content/skeb-summaries.json'))).mtimeMs;
    await f.command('prepare');
    await f.command('apply');
    await f.command('publish');
    expect((await stat(resolve(f.root, 'src/content/skeb-summaries.json'))).mtimeMs).toBe(before);
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
