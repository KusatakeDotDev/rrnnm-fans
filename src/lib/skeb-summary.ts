export const SUMMARY_VERSION = 2;
export type WorkQuote = { text: string; url: string; retrieved: string; provenance?: 'user-provided' };
export type Summary = { heading: string; quote: WorkQuote; tags: string[] };
export type SummaryRecord = {
  url: string;
  inputHash: string | null;
  status: 'missing' | 'pending' | 'failed' | 'awaiting-review' | 'approved';
  summary?: Summary;
};
export type SummaryData = { version: 2; works: SummaryRecord[] };

export function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))) throw new Error('Invalid object fields');
}

export function hash(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid hash');
}

function shortText(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() ||
      [...value].length > max || /[\p{Cc}\p{Cf}<>]/u.test(value)) throw new Error('Invalid summary text');
}

export function validateQuote(value: unknown): WorkQuote {
  object(value, ['text', 'url', 'retrieved', 'provenance']);
  if ('provenance' in value && value.provenance !== 'user-provided') throw new Error('Invalid quote provenance');
  shortText(value.text, 80);
  if (typeof value.url !== 'string' || !/^https:\/\/skeb\.jp\/@rurino_nemo\/works\/[1-9]\d*$/.test(value.url)) throw new Error('Invalid quote source');
  if (typeof value.retrieved !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.retrieved) ||
      !Number.isFinite(Date.parse(value.retrieved)) || new Date(value.retrieved).toISOString().slice(0, 10) !== value.retrieved ||
      value.retrieved > new Date().toISOString().slice(0, 10)) throw new Error('Invalid quote date');
  return { text: value.text, url: value.url, retrieved: value.retrieved,
    ...(value.provenance === 'user-provided' ? { provenance: value.provenance } : {}),
  };
}

export function validateSummary(value: unknown): Summary {
  object(value, ['heading', 'quote', 'tags']);
  shortText(value.heading, 32);
  validateQuote(value.quote);
  if (!Array.isArray(value.tags) || value.tags.length > 3) throw new Error('Invalid tags');
  value.tags.forEach((tag) => shortText(tag, 12));
  if (new Set(value.tags).size !== value.tags.length) throw new Error('Duplicate tags');
  return value as Summary;
}

export function validateSummaryData(value: unknown, urls: readonly string[]): SummaryData {
  object(value, ['version', 'works']);
  if (value.version !== SUMMARY_VERSION || !Array.isArray(value.works) || value.works.length !== urls.length) {
    throw new Error('Invalid summary data');
  }
  const seen = new Set<string>();
  for (const row of value.works) {
    object(row, ['url', 'inputHash', 'status', 'summary']);
    if (typeof row.url !== 'string' || !urls.includes(row.url) || seen.has(row.url)) throw new Error('Invalid work URL');
    seen.add(row.url);
    if (row.status === 'missing') {
      if (row.inputHash !== null) throw new Error('Missing input must have no hash');
    } else {
      hash(row.inputHash);
      if (typeof row.status !== 'string' || !['pending', 'failed', 'awaiting-review', 'approved'].includes(row.status)) throw new Error('Invalid status');
    }
    if (row.status === 'approved') {
      const summary = validateSummary(row.summary);
      if (summary.quote.url !== row.url) throw new Error('Quote source mismatch');
    }
    else if ('summary' in row) throw new Error('Unapproved summary must not be published');
  }
  return value as SummaryData;
}
