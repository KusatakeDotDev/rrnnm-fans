/**
 * 予定のカード（ADR-0004「サムネイル表示の可否についての判断」）の取得の判定。取りに行くのは src/data/schedule-oembed.ts。
 * 判定を単体テストとミューテーションテストに掛けるため、ここは受け取った値だけを見る（ADR-0003「層1 — 純関数だけを置く」）。
 */
import { isOEmbed, type OEmbed } from './youtube';

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

export function readScheduleOEmbed(response: Status, body: string): { ok: true; oembed: OEmbed } | Failure {
  if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (error) {
    return { ok: false, reason: `JSON として読めない: ${String(error)}` };
  }
  return isOEmbed(json) ? { ok: true, oembed: json } : { ok: false, reason: 'oEmbed の形でない' };
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
