/**
 * 配信スケジュールの更新の通知（ADR-0035 の決定）。購読を受け付けるリクエストと、5分ごとの Cron で、サムネイルが
 * 差し替わったかを見て、購読しているブラウザへ中身の無い push を送る。
 */
import { NOTIFY_PAGE, VAPID_PUBLIC_KEY, VAPID_SUBJECT } from "../src/data/notify";
import { MAXRES_URL } from "../src/data/schedule";
import {
  hex,
  isGone,
  pushTarget,
  readEndpoint,
  vapidAuthorization,
  vapidPrivateJwk,
  vapidSigningInput,
} from "../src/lib/web-push";

/** Workers KV のうち、ここで使う分。 */
export interface NotifyKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; limit: number; cursor?: string }): Promise<{
    keys: { name: string; metadata?: unknown }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface NotifyEnv {
  ASSETS: { fetch(input: Request | string): Promise<Response> };
  NOTIFY: NotifyKv;
  /** VAPID の秘密鍵（`d` を base64url にしたもの）。Worker のシークレットに置く。 */
  VAPID_PRIVATE_KEY?: string;
}

export type NotifyFetch = (url: string, init: RequestInit) => Promise<Response>;

/** 購読のキーの頭。宛先の URL は、キーには長すぎうるので、ハッシュをキーにし、URL はメタデータに置く（一覧で読み出せる）。 */
export const SUBSCRIPTION_PREFIX = "sub:";
/**
 * Cron の状態（JSON の CronState）。1回の Cron で書くのは、最後の1回だけにする。KV は同じキーへの書き込みが1秒に1回までで、
 * 2回目が落ちると、送り終えた回をもう一度送ってしまうため。
 */
export const STATE_KEY = "state";

/** `hash` は前回見たサムネイルのハッシュ。`cursor` があれば送っている途中で、次に送る購読の一覧のカーソル（最初からなら空の文字列）。 */
export interface CronState {
  hash: string;
  cursor?: string;
}

/**
 * 1回の Cron で送る数。無料プランのサブリクエスト（KV の操作も数える）は1回50件までで、送る分と、切れた宛先を消す分と、
 * ほかの4件（状態の読み取り・サムネイル・一覧・状態の書き込み）が収まる数にする（ADR-0035「無料プランの上限に合わせて、
 * 1回に送る数を区切る」）。
 */
export const BATCH = 20;
/** 端末が繋がっていないとき、push のサービスに預けておく秒数。今週の予定の知らせなので、1日を越えて届けない。 */
export const PUSH_TTL_S = 24 * 60 * 60;
/** 購読の本文の上限（バイト）。CPU 時間が 10 ms の無料プランで、大きな本文を読まないため。 */
const MAX_BODY_BYTES = 2048;

const status = (code: number, headers?: HeadersInit) =>
  new Response(null, { status: code, headers });

async function sha256(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/** 購読を足す（POST）・消す（DELETE）。設定のページが無いビルドでは、Worker が無かったときと同じ応答にする。 */
export async function handleSubscriptions(request: Request, env: NotifyEnv): Promise<Response> {
  const page = await env.ASSETS.fetch(new URL(NOTIFY_PAGE, request.url).href);
  await page.body?.cancel();
  if (!page.ok) return env.ASSETS.fetch(request);
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
async function thumbnailHash(fetchPush: NotifyFetch): Promise<string | null> {
  // Cloudflare の端に覚えさせた古い画像（`cache-control: max-age=300`）を読まないため。
  const response = await fetchPush(MAXRES_URL, { cache: "no-store" }).catch(() => null);
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
  const { hash, cursor } = state as Partial<Record<keyof CronState, unknown>>;
  // 形の違う状態は、読めない状態と同じに扱う。古いハッシュのまま送り続けたり、同じ回を送り直し続けたりしないため。
  if (typeof hash !== "string" || (cursor !== undefined && typeof cursor !== "string")) return null;
  return cursor === undefined ? { hash } : { hash, cursor };
}

/** push のサービスのオリジンごとに、JWT を1回だけ作る。 */
function vapidSigner(privateKey: string, publicKey: string, now: number) {
  const key = crypto.subtle.importKey(
    "jwk",
    vapidPrivateJwk(publicKey, privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const tokens = new Map<string, Promise<string>>();
  return (audience: string): Promise<string> => {
    let token = tokens.get(audience);
    if (!token) {
      token = (async () => {
        const input = vapidSigningInput(audience, VAPID_SUBJECT, now);
        const signature = await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          await key,
          new TextEncoder().encode(input),
        );
        return vapidAuthorization(input, new Uint8Array(signature), publicKey);
      })();
      tokens.set(audience, token);
    }
    return token;
  };
}

/**
 * Cron で呼ぶ。送っている途中なら続きを、そうでなければサムネイルを見て、変わっていたら最初から送る。1回に送るのは BATCH 件まで。
 * 初めて見たサムネイルは、覚えるだけで送らない。取れなければ、何も書き換えない。
 * 宛先が切れていたら（404・410）消す。ほかの失敗は消さずに残し、次に変わったときにまた送る。
 * 状態は送り終えてから書くので、途中で落ちると、次の Cron が同じ回を送り直す。
 */
export async function runCron(
  env: NotifyEnv,
  fetchPush: NotifyFetch = fetch,
  now: number = Date.now(),
  publicKey: string = VAPID_PUBLIC_KEY,
): Promise<void> {
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!privateKey) {
    // 送れないまま差し替えを覚えると、その差し替えは鍵を置いたあとも知らせられないため、見ることもしない。
    console.error("[notify] VAPID_PRIVATE_KEY が無いので、サムネイルを見ない");
    return;
  }
  const state = readState(await env.NOTIFY.get(STATE_KEY));
  let sending: Required<CronState>;
  if (state?.cursor !== undefined) {
    sending = { hash: state.hash, cursor: state.cursor };
  } else {
    const hash = await thumbnailHash(fetchPush);
    if (hash === null || hash === state?.hash) return;
    if (state === null) return env.NOTIFY.put(STATE_KEY, JSON.stringify({ hash }));
    sending = { hash, cursor: "" };
  }
  const page = await env.NOTIFY.list({
    prefix: SUBSCRIPTION_PREFIX,
    limit: BATCH,
    ...(sending.cursor ? { cursor: sending.cursor } : {}),
  });
  const authorization = vapidSigner(privateKey, publicKey, now);
  await Promise.all(
    page.keys.map(async ({ name, metadata }) => {
      const target = pushTarget(metadata);
      if (target === null) return env.NOTIFY.delete(name);
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
      }).catch(() => null);
      await response?.body?.cancel();
      if (response && isGone(response.status)) await env.NOTIFY.delete(name);
    }),
  );
  const done = page.list_complete || !page.cursor;
  const next: CronState = done
    ? { hash: sending.hash }
    : { hash: sending.hash, cursor: page.cursor! };
  await env.NOTIFY.put(STATE_KEY, JSON.stringify(next));
}
