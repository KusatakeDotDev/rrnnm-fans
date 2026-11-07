/**
 * 配信スケジュールの更新の通知（ADR-0035 の決定）。購読を受け付けるリクエストと、5分ごとの Cron でサムネイルが差し替わったかを
 * 見て送る処理（Workflow）を始めることと、その Workflow の中身（deliver）を持つ。Workflow のクラスは worker/notify-workflow.ts。
 */
import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";

import { NOTIFY_PAGE, VAPID_PUBLIC_KEY, VAPID_SUBJECT } from "../src/data/notify";
import { HQ_URL } from "../src/data/schedule";
import {
  hex,
  isGone,
  pushTarget,
  readEndpoint,
  vapidAuthorization,
  vapidPrivateJwk,
  vapidSigningInput,
} from "../src/lib/web-push";
import { serviceWorkerResponse } from "./service-worker";

/** Workers KV のうち、ここで使う分。 */
export interface NotifyKv {
  get(key: string): Promise<string | null>;
  getWithMetadata(key: string): Promise<{ value: string | null; metadata: unknown }>;
  put(key: string, value: string, options?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; limit: number; cursor?: string }): Promise<{
    keys: { name: string; metadata?: unknown }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

/** 送る処理（NotifyWorkflow）に渡すもの。 */
export interface DeliveryParams {
  /** 差し替わったサムネイルのハッシュ。 */
  hash: string;
}

/** Workflows のバインディングのうち、ここで使う分。 */
export interface DeliveryWorkflow {
  get(id: string): Promise<unknown>;
  create(options: {
    id: string;
    params: DeliveryParams;
    retention: { successRetention: string; errorRetention: string };
  }): Promise<unknown>;
}

export interface NotifyEnv {
  ASSETS: { fetch(input: Request | string): Promise<Response> };
  NOTIFY: NotifyKv;
  NOTIFY_WORKFLOW: DeliveryWorkflow;
  /** VAPID の秘密鍵（`d` を base64url にしたもの）。Worker のシークレットに置く。 */
  VAPID_PRIVATE_KEY?: string;
}

export type NotifyFetch = (url: string, init: RequestInit) => Promise<Response>;

/** 購読のキーの頭。宛先の URL は、キーには長すぎうるので、ハッシュをキーにし、URL はメタデータに置く（一覧で読み出せる）。 */
export const SUBSCRIPTION_PREFIX = "sub:";
/**
 * 前回見たサムネイルのハッシュ（JSON の CronState）。名前に、ハッシュを取る画像を入れる。画像を替えたときに、前の画像のハッシュと
 * 比べて、差し替わっていないのに送らないよう、名前ごと替えて覚え直しから始めるため。
 */
export const STATE_KEY = "state:hqdefault";

export interface CronState {
  hash: string;
}

/**
 * 送る処理のインスタンスを残す期間。同じ画像のインスタンスが残っているあいだは、その画像に戻っても送らない
 * （ADR-0035「送るのは Workflows に任せる」）。プランの既定に任せず、期間をここで決める。
 */
export const DELIVERY_RETENTION = "7 days";
/** 1ページの購読の数。送るステップが落ちたときに届かない人を、このページの分にとどめる（ADR-0035「送るのは Workflows に任せる」）。 */
export const PAGE_SIZE = 100;
/** 送るステップはやり直さない。やり直すと、そのページで送り終えていた人に、同じ通知を二重に送るため（ADR-0035「送るのは Workflows に任せる」）。 */
export const SEND_STEP: WorkflowStepConfig = { retries: { limit: 0, delay: 0 } };
/** push のサービスが答えない宛先を待つ上限（ミリ秒）。1つの宛先のために、同じページのほかの宛先を待たせ続けないため。 */
export const PUSH_TIMEOUT_MS = 10_000;
/**
 * 同時に扱う宛先の数。Workers は、1回の実行で応答を待てる接続が fetch と KV を合わせて6つまでで、超えた分は待たされる。
 * 待たされているあいだに PUSH_TIMEOUT_MS が進み、答えの遅い宛先のせいでほかの宛先が失敗にならないよう、6つずつ扱う。
 */
export const PUSH_CONCURRENCY = 6;
/** 端末が繋がっていないとき、push のサービスに預けておく秒数。今週の予定の知らせなので、1日を越えて届けない。 */
export const PUSH_TTL_S = 24 * 60 * 60;
/** 購読の本文の上限（バイト）。ブラウザの外から大きな本文を送り込まれても、読まないため。 */
const MAX_BODY_BYTES = 2048;

const status = (code: number, headers?: HeadersInit) =>
  new Response(null, { status: code, headers });

async function sha256(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/** 設定のページがあるビルドか。無いビルド（未公開のあいだの本番）では、通知の API も Service Worker も返さない（ADR-0035 の決定）。 */
async function hasNotifyPage(request: Request, env: NotifyEnv): Promise<boolean> {
  const page = await env.ASSETS.fetch(new URL(NOTIFY_PAGE, request.url).href);
  await page.body?.cancel();
  return page.ok;
}

/** Service Worker（worker/service-worker.ts）。設定のページが無いビルドでは、Worker が無かったときと同じ応答にする。 */
export async function handleServiceWorker(request: Request, env: NotifyEnv): Promise<Response> {
  if (!(await hasNotifyPage(request, env))) return env.ASSETS.fetch(request);
  if (request.method !== "GET" && request.method !== "HEAD")
    return status(405, { allow: "GET, HEAD" });
  return serviceWorkerResponse();
}

/** 購読を足す（POST）・消す（DELETE）。設定のページが無いビルドでは、Worker が無かったときと同じ応答にする。 */
export async function handleSubscriptions(request: Request, env: NotifyEnv): Promise<Response> {
  if (!(await hasNotifyPage(request, env))) return env.ASSETS.fetch(request);
  if (request.method !== "POST" && request.method !== "DELETE") {
    return status(405, { allow: "POST, DELETE" });
  }
  // ほかのサイトのページから、来た人のブラウザに購読を足させないため。
  if (request.headers.get("origin") !== new URL(request.url).origin) return status(403);
  const length = Number(request.headers.get("content-length"));
  if (!(length > 0 && length <= MAX_BODY_BYTES)) return status(413);
  const endpoint = readEndpoint(await request.json().catch(() => null));
  if (endpoint === null) return status(400);
  const key = SUBSCRIPTION_PREFIX + (await sha256(endpoint));
  try {
    if (request.method === "POST") await env.NOTIFY.put(key, "", { metadata: endpoint });
    else await env.NOTIFY.delete(key);
  } catch {
    // 同じ宛先を1秒のうちに足して消すと、KV の同じキーへの書き込みの上限（1秒に1回）に当たる。ページに、少しおいて頼み直させる。
    return status(503, { "retry-after": "1" });
  }
  return status(204);
}

/** 今のサムネイルのハッシュ。取れなければ null。 */
async function thumbnailHash(fetchThumbnail: NotifyFetch, now: number): Promise<string | null> {
  // YouTube のエッジは、クエリ無しの URL に差し替える前の画像を返し続けうる（ADR-0004「サムネイルの URL にクエリを付ける」）。
  // ブラウザの5分ごとの番号とは重ならないミリ秒の時刻を付ける。
  const url = `${HQ_URL}?t=${now}`;
  // Cloudflare のエッジに覚えさせた古い画像（`cache-control: max-age=300`）を読まないため。
  const response = await fetchThumbnail(url, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) {
    await response?.body?.cancel();
    return null;
  }
  return sha256(await response.arrayBuffer());
}

function readState(value: string | null): CronState | null {
  if (value === null) return null;
  let state: unknown;
  try {
    state = JSON.parse(value);
  } catch {
    // 読めない状態は、初めて見たときと同じに扱い、今のハッシュを覚え直す。毎回の Cron で落ち続けないため。
    return null;
  }
  if (typeof state !== "object" || state === null) return null;
  const { hash } = state as Partial<Record<keyof CronState, unknown>>;
  return typeof hash === "string" ? { hash } : null;
}

/** 差し替わったサムネイルごとの、送る処理のインスタンスの ID。 */
export const deliveryId = (hash: string) => `schedule-${hash}`;

/** 送る処理を始める。同じ画像のインスタンスが残っていれば、始めない。 */
async function startDelivery(workflow: DeliveryWorkflow, hash: string): Promise<void> {
  const id = deliveryId(hash);
  // create は、ID が使われているときのエラーを、ほかの失敗と見分ける方法がドキュメントに無いので、先に get で見る。
  // get が一時的に落ちても、create が使われている ID で落ちるので、ハッシュを書き換えずに次の Cron で見直す。
  const exists = await workflow.get(id).then(
    () => true,
    () => false,
  );
  if (exists) return;
  await workflow.create({
    id,
    params: { hash },
    retention: { successRetention: DELIVERY_RETENTION, errorRetention: DELIVERY_RETENTION },
  });
}

/**
 * Cron で呼ぶ。サムネイルが差し替わっていたら、送る処理（NotifyWorkflow）を始めてから、覚えているハッシュを書き換える。
 * 初めて見たサムネイルは、覚えるだけで送らない。取れなければ、何も書き換えない。
 * 送る処理を始められなければ、ハッシュを書き換えないので、次の Cron がもう一度始める。
 */
export async function runCron(
  env: NotifyEnv,
  fetchThumbnail: NotifyFetch = fetch,
  now: number = Date.now(),
): Promise<void> {
  if (!env.VAPID_PRIVATE_KEY) {
    // 送れないまま差し替えを覚えると、その差し替えは鍵を置いたあとも知らせられないため、見ることもしない。
    console.error("[notify] VAPID_PRIVATE_KEY が無いので、サムネイルを見ない");
    return;
  }
  const previous = readState(await env.NOTIFY.get(STATE_KEY));
  const hash = await thumbnailHash(fetchThumbnail, now);
  if (hash === null || hash === previous?.hash) return;
  if (previous !== null) await startDelivery(env.NOTIFY_WORKFLOW, hash);
  await env.NOTIFY.put(STATE_KEY, JSON.stringify({ hash } satisfies CronState));
}

/** push のサービスのオリジンごとに、JWT を1回だけ作る。 */
function vapidSigner(privateKey: string, publicKey: string, now: number) {
  // 送る先が無いページで読み込まないため。読み込めなかったときに、誰も待たない Promise が落ちたままにならない。
  let key: Promise<CryptoKey> | undefined;
  const tokens = new Map<string, Promise<string>>();
  return (audience: string): Promise<string> => {
    let token = tokens.get(audience);
    if (!token) {
      const signingKey = (key ??= crypto.subtle.importKey(
        "jwk",
        vapidPrivateJwk(publicKey, privateKey),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      ));
      token = (async () => {
        const input = vapidSigningInput(audience, VAPID_SUBJECT, now);
        const signature = await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          await signingKey,
          new TextEncoder().encode(input),
        );
        return vapidAuthorization(input, new Uint8Array(signature), publicKey);
      })();
      tokens.set(audience, token);
    }
    return token;
  };
}

/** 一覧を読むステップの結果。宛先の URL は持たせず、キー（宛先のハッシュ）だけにする。インスタンスの状態に残るため。 */
export interface DeliveryPage {
  keys: string[];
  /** 次のページのカーソル。最後のページなら null。 */
  next: string | null;
}

/** 送るステップの結果（件数）。 */
export interface PageResult {
  sent: number;
  gone: number;
  failed: number;
}

async function readPage(kv: NotifyKv, cursor: string): Promise<DeliveryPage> {
  const page = await kv.list({
    prefix: SUBSCRIPTION_PREFIX,
    limit: PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
  });
  return {
    keys: page.keys.map(({ name }) => name),
    next: page.list_complete || !page.cursor ? null : page.cursor,
  };
}

/** `items` を、同時に `limit` 件までにして `task` に渡す。結果は `items` の順に並べる。 */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/** 1ページの購読に送る。宛先ごとの失敗は、その宛先の中で受け止め、ほかの宛先に広げない。 */
async function sendPage(
  env: NotifyEnv,
  keys: readonly string[],
  privateKey: string,
  fetchPush: NotifyFetch,
  now: number,
  publicKey: string,
): Promise<PageResult> {
  const authorization = vapidSigner(privateKey, publicKey, now);
  const forget = (name: string) =>
    env.NOTIFY.delete(name).catch((error: unknown) =>
      console.error(`[notify] ${name} を消せなかった`, error),
    );
  const outcomes = await mapLimited(
    keys,
    PUSH_CONCURRENCY,
    async (name): Promise<keyof PageResult | null> => {
      try {
        const { value, metadata } = await env.NOTIFY.getWithMetadata(name);
        // 一覧を読んだあとに、やめた人。
        if (value === null) return null;
        const target = pushTarget(metadata);
        if (target === null) {
          await forget(name);
          return "gone";
        }
        const response = await fetchPush(target.endpoint, {
          method: "POST",
          // 転送先は宛先の検査を通っていないので、VAPID の署名を付けたまま追わない。3xx は、ほかの失敗と同じく残す。
          redirect: "manual",
          headers: {
            authorization: await authorization(target.audience),
            ttl: String(PUSH_TTL_S),
            urgency: "normal",
            "content-length": "0",
          },
          signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
        });
        await response.body?.cancel();
        if (isGone(response.status)) {
          await forget(name);
          return "gone";
        }
        return response.ok ? "sent" : "failed";
      } catch (error) {
        console.error(`[notify] ${name} に送れなかった`, error);
        return "failed";
      }
    },
  );
  const result: PageResult = { sent: 0, gone: 0, failed: 0 };
  for (const outcome of outcomes) if (outcome) result[outcome]++;
  return result;
}

/**
 * 送る処理（NotifyWorkflow の中身）。購読をページに分け、ページごとに、一覧を読むステップと送るステップを分ける。
 * 次のページの位置を、送る前に一覧を読むステップで覚えるので、送るステップが落ちても、次のページから続けられる。
 * 送るステップは、やり直さない（SEND_STEP）。
 */
export async function deliver(
  step: WorkflowStep,
  env: NotifyEnv,
  fetchPush: NotifyFetch = fetch,
  publicKey: string = VAPID_PUBLIC_KEY,
): Promise<void> {
  const privateKey = env.VAPID_PRIVATE_KEY;
  // Cron は鍵が無ければ始めないので、ここに来るのは、始めたあとに鍵が消えたときだけ。インスタンスを失敗にして、画面で見えるようにする。
  if (!privateKey) throw new Error("VAPID_PRIVATE_KEY が無い");
  let cursor: string | null = "";
  for (let n = 0; cursor !== null; n++) {
    const from: string = cursor;
    const page = await step.do(`list ${n}`, () => readPage(env.NOTIFY, from));
    try {
      await step.do(`send ${n}`, SEND_STEP, () =>
        sendPage(env, page.keys, privateKey, fetchPush, Date.now(), publicKey),
      );
    } catch (error) {
      console.error(`[notify] ${n} ページ目を送れなかった`, error);
    }
    cursor = page.next;
  }
}
