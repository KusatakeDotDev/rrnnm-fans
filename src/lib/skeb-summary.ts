export const SUMMARY_VERSION = 2;
export type WorkQuote = {
  text: string;
  url: string;
  retrieved: string;
  provenance?: "user-provided";
};
export type Summary = { heading: string; quote: WorkQuote; tags: string[] };
export type SummaryRecord = {
  url: string;
  inputHash: string | null;
  status: "missing" | "pending" | "failed" | "awaiting-review" | "approved";
  summary?: Summary;
};
export type SummaryData = { version: 2; works: SummaryRecord[] };

export function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("Invalid object fields");
}

export function hash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid hash");
}

/** `list` のどれかか。includes は型の違う値と一致しないので、型の確かめも兼ねる。 */
export function oneOf<T>(list: readonly T[], value: unknown): value is T {
  return (list as readonly unknown[]).includes(value);
}

function shortText(value: unknown, max: number): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    Array.from(value).length > max ||
    /[\p{Cc}\p{Cf}<>]/u.test(value)
  )
    throw new Error("Invalid summary text");
}

export function validateQuote(value: unknown): WorkQuote {
  object(value, ["text", "url", "retrieved", "provenance"]);
  if ("provenance" in value && value.provenance !== "user-provided")
    throw new Error("Invalid quote provenance");
  shortText(value.text, 80);
  if (
    typeof value.url !== "string" ||
    !/^https:\/\/skeb\.jp\/@rurino_nemo\/works\/[1-9]\d*$/.test(value.url)
  )
    throw new Error("Invalid quote source");
  // Stryker disable next-line ConditionalExpression: JSON から読める値なら、文字列でなくても下の toISOString との照合で同じように弾く
  if (typeof value.retrieved !== "string") throw new Error("Invalid quote date");
  if (
    // Stryker disable next-line Regex: 下の toISOString との照合は10文字の値しか通さず、この形も10文字ちょうどなので、アンカーを外しても結果が同じ
    !/^\d{4}-\d{2}-\d{2}$/.test(value.retrieved) ||
    !Number.isFinite(Date.parse(value.retrieved)) ||
    new Date(value.retrieved).toISOString().slice(0, 10) !== value.retrieved ||
    // Stryker disable next-line MethodExpression: 取得日は10文字なので、今の時刻を日付で切っても切らなくても大小が同じ
    value.retrieved > new Date().toISOString().slice(0, 10)
  )
    throw new Error("Invalid quote date");
  return {
    text: value.text,
    url: value.url,
    retrieved: value.retrieved,
    ...(value.provenance === "user-provided" ? { provenance: value.provenance } : {}),
  };
}

export function validateSummary(value: unknown): Summary {
  object(value, ["heading", "quote", "tags"]);
  shortText(value.heading, 32);
  validateQuote(value.quote);
  if (!Array.isArray(value.tags) || value.tags.length > 3) throw new Error("Invalid tags");
  value.tags.forEach((tag) => shortText(tag, 12));
  if (new Set(value.tags).size !== value.tags.length) throw new Error("Duplicate tags");
  return value as Summary;
}

export function validateSummaryData(value: unknown, urls: readonly string[]): SummaryData {
  object(value, ["version", "works"]);
  if (
    value.version !== SUMMARY_VERSION ||
    !Array.isArray(value.works) ||
    value.works.length !== urls.length
  ) {
    throw new Error("Invalid summary data");
  }
  const seen = new Set<string>();
  for (const row of value.works) {
    object(row, ["url", "inputHash", "status", "summary"]);
    if (!oneOf(urls, row.url) || seen.has(row.url)) throw new Error("Invalid work URL");
    seen.add(row.url);
    if (row.status === "missing") {
      if (row.inputHash !== null) throw new Error("Missing input must have no hash");
    } else {
      hash(row.inputHash);
      if (!oneOf(["pending", "failed", "awaiting-review", "approved"], row.status))
        throw new Error("Invalid status");
    }
    if (row.status === "approved") {
      const summary = validateSummary(row.summary);
      if (summary.quote.url !== row.url) throw new Error("Quote source mismatch");
    } else if ("summary" in row) throw new Error("Unapproved summary must not be published");
  }
  return value as SummaryData;
}
