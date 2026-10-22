/**
 * 予定のカード（ADR-0004「サムネイル表示の可否についての判断」）の取得の判定。取りに行くのは src/data/schedule-oembed.ts。
 * 判定を単体テストとミューテーションテストに掛けるため、ここは受け取った値だけを見る（ADR-0003「層1 — 純関数だけを置く」）。
 */

export interface Failure {
  ok: false;
  reason: string;
}

interface Status {
  ok: boolean;
  status: number;
}

// YouTube は、未生成の maxresdefault に、数 KB の灰色のプレースホルダーを 200 で返すことがある。実物のサムネイルとの境に余裕を持たせた値。
const MIN_MAXRES_BYTES = 10_000;

/** fetch が投げたもの。Node の fetch は、届かなかった理由（名前解決・接続・TLS）を cause に入れ、本体は「fetch failed」とだけ言う。 */
export function fetchErrorReason(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  return cause === undefined ? String(error) : `${String(error)}（${String(cause)}）`;
}

/** 予定のカードが oEmbed から使う分。 */
export interface ScheduleOEmbed {
  title: string;
  author_name: string | undefined;
  provider_name: string;
  thumbnail: { url: string; width: number; height: number } | undefined;
}

// これから始まるライブ（待機所）の oEmbed は、title・author_name・thumbnail_* を返さず、題名は html の iframe にだけある
// （RRNNM-106）。その属性値は &amp;・&#39; などでエスケープされている。
const IFRAME_TITLE = /<iframe\b[^>]*\stitle="([^"]+)"/;
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"' } as const;

function iframeTitle(html: unknown): string | undefined {
  const match = IFRAME_TITLE.exec(String(html));
  return match
    ? match[1]!.replace(
        /&(?:#(\d+)|(amp|lt|gt|quot));/g,
        (_, code: string | undefined, name: keyof typeof NAMED_ENTITIES) =>
          code === undefined ? NAMED_ENTITIES[name] : String.fromCodePoint(Number(code)),
      )
    : undefined;
}

/** 文字列でない・空白だけの作者名は、無いものとして扱う（出典の行では決まった名前に替える。ADR-0004「出典の行に作者名を出す」）。 */
function authorName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function readScheduleOEmbed(response: Status, body: string): { ok: true; oembed: ScheduleOEmbed } | Failure {
  if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (error) {
    return { ok: false, reason: `JSON として読めない: ${String(error)}` };
  }
  // 数や文字列の JSON はプロパティが無いだけで済むので、落とすのは null だけでよい。
  const v = (json ?? {}) as Record<string, unknown>;
  const title = typeof v.title === 'string' ? v.title : iframeTitle(v.html);
  if (typeof v.provider_name !== 'string' || title === undefined) return { ok: false, reason: 'oEmbed の形でない' };
  const { thumbnail_url: url, thumbnail_width: width, thumbnail_height: height } = v;
  return {
    ok: true,
    oembed: {
      title,
      author_name: authorName(v.author_name),
      provider_name: v.provider_name,
      thumbnail:
        typeof url === 'string' && typeof width === 'number' && typeof height === 'number' ? { url, width, height } : undefined,
    },
  };
}

export function readMaxresHead(head: Status & { contentLength: string | null }): { ok: true } | Failure {
  if (!head.ok) return { ok: false, reason: `HTTP ${head.status}` };
  if (head.contentLength === null) return { ok: false, reason: 'content-length が無い' };
  // 数として読めない長さも、小さいほうに倒す（NaN はどの比較も偽）。
  if (!(Number(head.contentLength) > MIN_MAXRES_BYTES)) {
    return { ok: false, reason: `${head.contentLength} バイトしかない（未生成のプレースホルダー）` };
  }
  return { ok: true };
}
