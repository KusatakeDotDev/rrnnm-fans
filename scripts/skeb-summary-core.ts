import { createHash } from 'node:crypto';
import { SUMMARY_VERSION, hash, object, validateQuote, validateSummary, validateSummaryData } from '../src/lib/skeb-summary.ts';
import type { Summary, SummaryData, SummaryRecord, WorkQuote } from '../src/lib/skeb-summary.ts';

export type Input = { url: string; description: string; sourceTags?: string[]; quote?: WorkQuote };
export type Result = { url: string; inputHash: string; status: 'generated'; summary: Summary } |
  { url: string; inputHash: string; status: 'failed' };
export type State = { version: 2; inputs: Input[]; results: Result[]; approvals: string[] };
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const inputHash = (input: Input) => digest({ version: SUMMARY_VERSION, url: input.url,
  description: input.description, sourceTags: input.sourceTags ?? [],
  ...(input.quote ? { quote: validateQuote(input.quote) } : {}),
});
export const resultHash = (result: Result) => digest({
  url: result.url, inputHash: result.inputHash, status: result.status,
  ...(result.status === 'generated' ? { summary: {
    heading: result.summary.heading, quote: validateQuote(result.summary.quote), tags: result.summary.tags,
  } } : {}),
});

export function validateInput(value: unknown, urls: readonly string[]): Input {
  object(value, ['url', 'description', 'sourceTags', 'quote']);
  if (typeof value.url !== 'string' || !urls.includes(value.url) || typeof value.description !== 'string' ||
      !value.description.trim() || value.description.length > 20000) throw new Error('Invalid input');
  const sourceTags = 'sourceTags' in value ? value.sourceTags : [];
  if (!Array.isArray(sourceTags) || sourceTags.length > 50 || sourceTags.some((tag) =>
    typeof tag !== 'string' || !tag.trim() || tag.length > 100 || /[\p{Cc}\p{Cf}<>]/u.test(tag))) throw new Error('Invalid source tags');
  const quote = 'quote' in value ? validateQuote(value.quote) : undefined;
  if (quote && quote.url !== value.url) throw new Error('Quote source mismatch');
  return { url: value.url, description: value.description.replace(/\r\n?/g, '\n').trim(), sourceTags,
    ...(quote ? { quote } : {}),
  };
}

// 未対応の HTML entity は推測で変換せず、デコード済み metadata 入力に切り替えてもらう。
function decode(value: string): string {
  const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (_, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error('Invalid HTML entity');
      return String.fromCodePoint(code);
    }
    if (!Object.hasOwn(entities, name)) throw new Error('Unsupported HTML entity: use decoded metadata JSON');
    return entities[name];
  });
}

export function readDescription(html: string): string {
  const descriptions: string[] = [];
  const head = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .split(/<body\b|<\/head\s*>/i)[0];
  for (const match of head.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attributes: Record<string, string> = {};
    for (const attr of match[0].slice(5, -1).matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      const key = attr[1].toLowerCase();
      if (key in attributes) throw new Error('Duplicate meta attribute');
      attributes[key] = decode(attr[2] ?? attr[3] ?? attr[4]);
    }
    if (attributes.property?.toLowerCase() === 'og:description') descriptions.push(attributes.content ?? '');
  }
  if (descriptions.length !== 1 || !descriptions[0].trim()) throw new Error('Expected one nonempty og:description');
  return descriptions[0];
}

export function validateResult(value: unknown, inputs: Input[]): Result {
  object(value, ['url', 'inputHash', 'status', 'summary']);
  hash(value.inputHash);
  const input = inputs.find((item) => item.url === value.url);
  if (!input || inputHash(input) !== value.inputHash) throw new Error('Unknown or stale result');
  if (value.status === 'generated') {
    const summary = validateSummary(value.summary);
    if (!input.quote || JSON.stringify(validateQuote(input.quote)) !== JSON.stringify(validateQuote(summary.quote))) {
      throw new Error('Quote must match supplied work input');
    }
    return { url: input.url, inputHash: value.inputHash, status: 'generated', summary };
  }
  if (value.status !== 'failed' || 'summary' in value) throw new Error('Invalid result status');
  return { url: input.url, inputHash: value.inputHash, status: 'failed' };
}

export function validateState(value: unknown, urls: readonly string[]): State {
  object(value, ['version', 'inputs', 'results', 'approvals']);
  if (value.version !== SUMMARY_VERSION || !Array.isArray(value.inputs) || !Array.isArray(value.results) ||
      !Array.isArray(value.approvals)) throw new Error('Invalid state');
  const inputs = value.inputs.map((row) => validateInput(row, urls));
  const results = value.results.map((row) => validateResult(row, inputs));
  if (new Set(inputs.map((row) => row.url)).size !== inputs.length ||
      new Set(results.map((row) => row.url)).size !== results.length) throw new Error('Duplicate work');
  value.approvals.forEach(hash);
  if (value.approvals.some((approval) => !results.some((r) => r.status === 'generated' && resultHash(r) === approval))) {
    throw new Error('Stale approval');
  }
  return { version: 2, inputs, results, approvals: value.approvals as string[] };
}

export function prepare(inputs: Input[], previous: State): State {
  const results = previous.results.filter((result) => inputs.some((input) => input.url === result.url && inputHash(input) === result.inputHash));
  return { version: 2, inputs, results, approvals: previous.approvals.filter((approval) => results.some((r) => resultHash(r) === approval)) };
}

export function restoreState(value: unknown, urls: readonly string[]): State {
  object(value, ['version', 'inputs', 'results', 'approvals']);
  if (!Array.isArray(value.inputs)) throw new Error('Invalid state inputs');
  const savedUrls = value.inputs.map((input) => {
    object(input, ['url', 'description', 'sourceTags', 'quote']);
    if (typeof input.url !== 'string' || !/^https:\/\/skeb\.jp\/@rurino_nemo\/works\/[1-9]\d*$/.test(input.url)) {
      throw new Error('Invalid saved URL');
    }
    return input.url;
  });
  const state = validateState(value, [...urls, ...savedUrls]);
  return prepare(state.inputs.filter((input) => urls.includes(input.url)), state);
}

export function tasks(state: State) {
  return state.inputs.filter((input) => !state.results.some((r) => r.url === input.url)).map((input) => ({
    version: SUMMARY_VERSION, ...input, inputHash: inputHash(input),
  }));
}

export function publish(state: State, urls: readonly string[]): SummaryData {
  const works: SummaryRecord[] = urls.map((url) => {
    const input = state.inputs.find((item) => item.url === url);
    if (!input) return { url, inputHash: null, status: 'missing' };
    const result = state.results.find((item) => item.url === url);
    const common = { url, inputHash: inputHash(input) };
    if (!result) return { ...common, status: 'pending' };
    if (result.status === 'failed') return { ...common, status: 'failed' };
    if (!state.approvals.includes(resultHash(result))) return { ...common, status: 'awaiting-review' };
    return { ...common, status: 'approved', summary: result.summary };
  });
  return validateSummaryData({ version: 2, works }, urls);
}
