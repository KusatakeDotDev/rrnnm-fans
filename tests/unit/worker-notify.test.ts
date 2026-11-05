import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";

import { NOTIFY_PAGE, SUBSCRIPTIONS_PATH, VAPID_SUBJECT } from "../../src/data/notify";
import { MAXRES_URL } from "../../src/data/schedule";
import { base64url, fromBase64url } from "../../src/lib/web-push";
import { handle } from "../../worker/index";
import {
  BATCH,
  type NotifyEnv,
  type NotifyKv,
  PUSH_TTL_S,
  runCron,
  SUBSCRIPTION_PREFIX,
  STATE_KEY,
} from "../../worker/notify";

/**
 * worker/notify.ts — 配信スケジュールの更新の通知の、購読の受け付けと Cron（docs/adr/0035-schedule-push-notifications.md）。
 * 壊れると「設定のページを出す前に購読を受け付ける」「ほかのサイトから購読を足される」「差し替わっても送らない／差し替わって
 * いないのに送る」「無料プランの上限を越えて落ちる」「やめた人に送り続ける」「push のサービスが署名を受け付けない」の形で出る。
 */

const ORIGIN = "https://rrnnm.fans";
const NOW = Date.parse("2026-11-05T12:00:00Z");
const APPLE = "https://web.push.apple.com/abc";
const FCM = "https://fcm.googleapis.com/fcm/send/abc";

/** Workers KV と同じく、キーの名前の順に並べ、`limit` 件ずつカーソルで続きを返す。操作の数も数える。 */
function memoryKv(initial: Record<string, { value: string; metadata?: unknown }> = {}) {
  const store = new Map(Object.entries(initial));
  const ops: string[] = [];
  const kv: NotifyKv = {
    get: async (key) => {
      ops.push(`get ${key}`);
      return store.get(key)?.value ?? null;
    },
    put: async (key, value, options) => {
      ops.push(`put ${key}`);
      store.set(key, { value, metadata: options?.metadata });
    },
    delete: async (key) => {
      ops.push(`delete ${key}`);
      store.delete(key);
    },
    list: async ({ prefix, limit, cursor }) => {
      ops.push("list");
      const names = [...store.keys()].filter((name) => name.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const keys = names
        .slice(start, start + limit)
        .map((name) => ({ name, metadata: store.get(name)!.metadata }));
      const end = start + keys.length;
      return end < names.length
        ? { keys, list_complete: false, cursor: String(end) }
        : { keys, list_complete: true };
    },
  };
  return { kv, store, ops };
}

const subscriptionKey = (endpoint: string) =>
  SUBSCRIPTION_PREFIX + createHash("sha256").update(endpoint).digest("hex");
const subscribed = (...endpoints: string[]) =>
  Object.fromEntries(
    endpoints.map((endpoint) => [subscriptionKey(endpoint), { value: "", metadata: endpoint }]),
  );
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** 静的なファイル。`pages` にあるパスは 200、ほかは 404。 */
function assets(pages: readonly string[]) {
  const requested: string[] = [];
  return {
    requested,
    ASSETS: {
      fetch: async (input: Request | string) => {
        const url = new URL(typeof input === "string" ? input : input.url);
        requested.push(url.pathname);
        return pages.includes(url.pathname)
          ? new Response("page", { status: 200 })
          : new Response("not found", { status: 404 });
      },
    },
  };
}

async function keyPair() {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicKey = base64url(
    new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey)),
  );
  const { d } = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey, privateKey: d!, verifyKey: pair.publicKey };
}

/** サムネイルと push のサービスの代わり。サムネイルは `thumbnail` を返し、push は `pushStatus` の状態で答える。 */
function network(
  thumbnail: () => Response | Promise<Response>,
  pushStatus: (url: string) => number = () => 201,
) {
  const pushes: { url: string; init: RequestInit }[] = [];
  const thumbnails: RequestInit[] = [];
  const fetchPush = async (url: string, init: RequestInit) => {
    if (url === MAXRES_URL) {
      thumbnails.push(init);
      return thumbnail();
    }
    pushes.push({ url, init });
    return new Response(null, { status: pushStatus(url) });
  };
  return { fetchPush, pushes, thumbnails };
}

const subscribe = (method: string, body: unknown, headers: Record<string, string> = {}) => {
  const text = JSON.stringify(body);
  return new Request(`${ORIGIN}${SUBSCRIPTIONS_PATH}`, {
    method,
    body: text,
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "content-length": String(text.length),
      ...headers,
    },
  });
};

describe("購読の受け付け", () => {
  const env = (pages: readonly string[] = [NOTIFY_PAGE]) => {
    const { kv, store, ops } = memoryKv();
    const { ASSETS, requested } = assets(pages);
    return { env: { ASSETS, NOTIFY: kv } as NotifyEnv, store, ops, requested };
  };

  it("足すと、宛先のハッシュをキーにし、宛先をメタデータに置いて、204 を返す", async () => {
    const { env: e, store } = env();
    const response = await handle(subscribe("POST", { endpoint: APPLE, keys: {} }), e);
    expect(response.status).toBe(204);
    expect([...store]).toEqual([[subscriptionKey(APPLE), { value: "", metadata: APPLE }]]);
  });

  it("KV に書けなければ（同じキーへの書き込みは1秒に1回まで）、503 にして、少しおいて頼み直させる", async () => {
    const { env: e } = env();
    e.NOTIFY.put = () => Promise.reject(new Error("429"));
    e.NOTIFY.delete = () => Promise.reject(new Error("429"));
    for (const method of ["POST", "DELETE"]) {
      const response = await handle(subscribe(method, { endpoint: APPLE }), e);
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("1");
    }
  });

  it("消すと、同じキーを消して、204 を返す", async () => {
    const { env: e, store } = env();
    store.set(subscriptionKey(APPLE), { value: "", metadata: APPLE });
    store.set(subscriptionKey(FCM), { value: "", metadata: FCM });
    const response = await handle(subscribe("DELETE", { endpoint: APPLE }), e);
    expect(response.status).toBe(204);
    expect([...store.keys()]).toEqual([subscriptionKey(FCM)]);
  });

  it("設定のページが無いビルド（未公開のあいだの本番）では受け付けず、静的なファイルの応答にする", async () => {
    const { env: e, ops, requested } = env([]);
    const response = await handle(subscribe("POST", { endpoint: APPLE }), e);
    expect(response.status).toBe(404);
    expect(requested).toEqual([NOTIFY_PAGE, SUBSCRIPTIONS_PATH]);
    expect(ops).toEqual([]);
  });

  it("ほかのオリジンからのリクエストは、403 にして書かない", async () => {
    const { env: e, ops } = env();
    for (const origin of ["https://example.com", ""]) {
      const response = await handle(subscribe("POST", { endpoint: APPLE }, { origin }), e);
      expect(response.status).toBe(403);
    }
    expect(ops).toEqual([]);
  });

  it("POST・DELETE 以外は 405 にし、使えるメソッドを返す", async () => {
    const { env: e } = env();
    const response = await handle(
      new Request(`${ORIGIN}${SUBSCRIPTIONS_PATH}`, { headers: { origin: ORIGIN } }),
      e,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, DELETE");
  });

  it.each([
    ["大きすぎる", "2049"],
    ["長さが無い", ""],
    ["長さが 0", "0"],
    ["長さが数でない", "abc"],
  ])("本文の長さが受け付けられなければ、413 にして読まない（%s）", async (_, length) => {
    const { env: e, ops } = env();
    const response = await handle(
      subscribe("POST", { endpoint: APPLE }, { "content-length": length }),
      e,
    );
    expect(response.status).toBe(413);
    expect(ops).toEqual([]);
  });

  it("2048 バイトまでの本文は読む", async () => {
    const { env: e } = env();
    const body = {
      endpoint: APPLE,
      pad: "a".repeat(2048 - JSON.stringify({ endpoint: APPLE, pad: "" }).length),
    };
    expect(JSON.stringify(body).length).toBe(2048);
    expect((await handle(subscribe("POST", body), e)).status).toBe(204);
  });

  it.each([
    ["JSON でない", "not json"],
    ["push のサービスでない宛先", JSON.stringify({ endpoint: "https://example.com/abc" })],
  ])("本文が読めなければ、400 にして書かない（%s）", async (_, text) => {
    const { env: e, ops } = env();
    const request = new Request(`${ORIGIN}${SUBSCRIPTIONS_PATH}`, {
      method: "POST",
      body: text,
      headers: { origin: ORIGIN, "content-length": String(text.length) },
    });
    expect((await handle(request, e)).status).toBe(400);
    expect(ops).toEqual([]);
  });
});

describe("Cron", () => {
  const cronEnv = async (initial: Parameters<typeof memoryKv>[0] = {}) => {
    const keys = await keyPair();
    const { kv, store, ops } = memoryKv(initial);
    const env: NotifyEnv = { ...assets([]), NOTIFY: kv, VAPID_PRIVATE_KEY: keys.privateKey };
    const run = (fetchPush: Parameters<typeof runCron>[1]) =>
      runCron(env, fetchPush, NOW, keys.publicKey);
    return { env, store, ops, keys, run };
  };
  const image = (text: string) => () => new Response(text, { status: 200 });
  /** 前回見たサムネイルが `text` で、送っていない状態。 */
  const seen = (text: string) => ({
    [STATE_KEY]: { value: JSON.stringify({ hash: sha256(text) }) },
  });
  const stateOf = (store: Map<string, { value: string }>) =>
    JSON.parse(store.get(STATE_KEY)!.value);
  const stateWrites = (ops: readonly string[]) =>
    ops.filter((op) => op === `put ${STATE_KEY}` || op === `delete ${STATE_KEY}`);

  it("初めて見たサムネイルは、ハッシュを覚えるだけで送らない", async () => {
    const { store, run } = await cronEnv(subscribed(APPLE));
    const net = network(image("week-1"));
    await run(net.fetchPush);
    expect(stateOf(store)).toEqual({ hash: sha256("week-1") });
    expect(net.pushes).toEqual([]);
  });

  it("サムネイルは、Cloudflare の端に覚えさせたものを読まない", async () => {
    const { run } = await cronEnv();
    const net = network(image("week-1"));
    await run(net.fetchPush);
    expect(net.thumbnails).toEqual([{ cache: "no-store" }]);
  });

  it("前回と同じなら、何も書かず、送らない", async () => {
    const { ops, run } = await cronEnv({
      ...seen("week-1"),
      ...subscribed(APPLE),
    });
    const net = network(image("week-1"));
    await run(net.fetchPush);
    expect(ops).toEqual([`get ${STATE_KEY}`]);
    expect(net.pushes).toEqual([]);
  });

  it.each([
    ["エラーを返した", () => new Response("", { status: 404 })],
    ["繋がらなかった", () => Promise.reject(new TypeError("fetch failed"))],
  ])("サムネイルが取れなければ（%s）、ハッシュを書き換えず、送らない", async (_, thumbnail) => {
    const { ops, run } = await cronEnv({
      ...seen("week-1"),
      ...subscribed(APPLE),
    });
    const net = network(thumbnail);
    await run(net.fetchPush);
    expect(ops).toEqual([`get ${STATE_KEY}`]);
    expect(net.pushes).toEqual([]);
  });

  it("差し替わったら、ハッシュを書き換え、購読している全員に中身の無い push を送る", async () => {
    const { store, keys, run } = await cronEnv({
      ...seen("week-1"),
      ...subscribed(APPLE, FCM),
    });
    const net = network(image("week-2"));
    await run(net.fetchPush);
    expect(stateOf(store)).toEqual({ hash: sha256("week-2") });
    expect(net.pushes.map((push) => push.url).sort()).toEqual([APPLE, FCM].sort());
    for (const { url, init } of net.pushes) {
      expect(init.method).toBe("POST");
      expect(init.body).toBeUndefined();
      const headers = init.headers as Record<string, string>;
      expect(headers["ttl"]).toBe(String(PUSH_TTL_S));
      expect(headers["urgency"]).toBe("normal");
      expect(headers["content-length"]).toBe("0");
      const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(
        headers["authorization"]!,
      );
      expect(match).not.toBeNull();
      const [, header, claims, signature, k] = match!;
      expect(k).toBe(keys.publicKey);
      expect(JSON.parse(new TextDecoder().decode(fromBase64url(claims!)))).toEqual({
        aud: new URL(url).origin,
        exp: NOW / 1000 + 12 * 60 * 60,
        sub: VAPID_SUBJECT,
      });
      const valid = await webcrypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        keys.verifyKey,
        fromBase64url(signature!),
        new TextEncoder().encode(`${header}.${claims}`),
      );
      expect(valid).toBe(true);
    }
  });

  it("切れた宛先（404・410）は消し、ほかの失敗は残す", async () => {
    const endpoints = [0, 1, 2, 3].map((n) => `https://web.push.apple.com/${n}`);
    const codes = [404, 410, 500, 429];
    const { store, run } = await cronEnv({
      ...seen("week-1"),
      ...subscribed(...endpoints),
    });
    const net = network(image("week-2"), (url) => codes[endpoints.indexOf(url)]!);
    await run(net.fetchPush);
    expect([...store.keys()].filter((key) => key.startsWith(SUBSCRIPTION_PREFIX)).sort()).toEqual(
      [subscriptionKey(endpoints[2]!), subscriptionKey(endpoints[3]!)].sort(),
    );
  });

  it("push のサービスに繋がらなくても、宛先を残して最後まで送る", async () => {
    const { store, run } = await cronEnv({
      ...seen("week-1"),
      ...subscribed(APPLE, FCM),
    });
    const net = network(image("week-2"));
    const fetchPush = async (url: string, init: RequestInit) =>
      url === APPLE ? Promise.reject(new TypeError("fetch failed")) : net.fetchPush(url, init);
    await run(fetchPush);
    expect(net.pushes.map((push) => push.url)).toEqual([FCM]);
    expect(store.has(subscriptionKey(APPLE))).toBe(true);
    expect(stateOf(store)).toEqual({ hash: sha256("week-2") });
  });

  it("メタデータが受け付ける宛先でない購読は、送らずに消す", async () => {
    const bad = "https://example.com/abc";
    const { store, run } = await cronEnv({
      ...seen("week-1"),
      [subscriptionKey(bad)]: { value: "", metadata: bad },
    });
    const net = network(image("week-2"));
    await run(net.fetchPush);
    expect(net.pushes).toEqual([]);
    expect(store.has(subscriptionKey(bad))).toBe(false);
  });

  it(`1回に送るのは ${BATCH} 件までで、残りは次の Cron で続きから送り、そのあいだはサムネイルを見ない`, async () => {
    const endpoints = Array.from(
      { length: BATCH * 2 + 3 },
      (_, n) => `https://web.push.apple.com/${n}`,
    );
    const { store, ops, run } = await cronEnv({
      ...seen("week-1"),
      ...subscribed(...endpoints),
    });
    const sent: string[][] = [];
    for (let round = 0; round < 3; round++) {
      const net = network(image("week-2"));
      const before = ops.length;
      await run(net.fetchPush);
      sent.push(net.pushes.map((push) => push.url));
      expect(net.thumbnails).toHaveLength(round === 0 ? 1 : 0);
      expect(stateOf(store).hash).toBe(sha256("week-2"));
      expect("cursor" in stateOf(store)).toBe(round < 2);
      expect(stateWrites(ops.slice(before))).toEqual([`put ${STATE_KEY}`]);
    }
    expect(sent.map((urls) => urls.length)).toEqual([BATCH, BATCH, 3]);
    expect(new Set(sent.flat())).toEqual(new Set(endpoints));
    const net = network(image("week-2"));
    await run(net.fetchPush);
    expect(net.pushes).toEqual([]);
  });

  it("状態は、送り終えてから1回だけ書く（KV は同じキーへの書き込みが1秒に1回まで）", async () => {
    const { ops, run } = await cronEnv({ ...seen("week-1"), ...subscribed(APPLE, FCM) });
    const net = network(image("week-2"));
    await run(net.fetchPush);
    expect(stateWrites(ops)).toEqual([`put ${STATE_KEY}`]);
    expect(ops.at(-1)).toBe(`put ${STATE_KEY}`);
  });

  it("送る途中で落ちたら、状態は前のままで、次の Cron が同じ回を最初から送り直す", async () => {
    const { env, store, run } = await cronEnv({ ...seen("week-1"), ...subscribed(APPLE, FCM) });
    const kv = env.NOTIFY;
    env.NOTIFY = { ...kv, list: () => Promise.reject(new Error("KV が落ちた")) };
    await expect(run(network(image("week-2")).fetchPush)).rejects.toThrow("KV が落ちた");
    expect(stateOf(store)).toEqual({ hash: sha256("week-1") });
    env.NOTIFY = kv;
    const net = network(image("week-2"));
    await run(net.fetchPush);
    expect(net.pushes.map((push) => push.url).sort()).toEqual([APPLE, FCM].sort());
  });

  it("状態が読めなければ、初めて見たときと同じく、今のハッシュを覚えるだけで送らない", async () => {
    const { store, run } = await cronEnv({
      [STATE_KEY]: { value: "not json" },
      ...subscribed(APPLE),
    });
    const net = network(image("week-2"));
    await run(net.fetchPush);
    expect(stateOf(store)).toEqual({ hash: sha256("week-2") });
    expect(net.pushes).toEqual([]);
  });

  it.each([["null"], ['{"cursor":""}'], ['{"hash":1}']])(
    "状態の形が違っても（%s）、初めて見たときと同じに扱う",
    async (value) => {
      const { store, run } = await cronEnv({ [STATE_KEY]: { value }, ...subscribed(APPLE) });
      const net = network(image("week-2"));
      await run(net.fetchPush);
      expect(stateOf(store)).toEqual({ hash: sha256("week-2") });
      expect(net.pushes).toEqual([]);
    },
  );

  it("無料プランのサブリクエストの上限（50件）に、全部が切れた宛先のときも収まる", async () => {
    const endpoints = Array.from(
      { length: BATCH + 5 },
      (_, n) => `https://web.push.apple.com/${n}`,
    );
    const { ops, run } = await cronEnv({
      ...seen("week-1"),
      ...subscribed(...endpoints),
    });
    const net = network(image("week-2"), () => 410);
    await run(net.fetchPush);
    expect(ops.length + net.pushes.length + net.thumbnails.length).toBeLessThanOrEqual(50);
  });

  it("秘密鍵が無ければ、サムネイルも見ない", async () => {
    const { env, ops } = await cronEnv({
      ...seen("week-1"),
      ...subscribed(APPLE),
    });
    const net = network(image("week-2"));
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await runCron({ ...env, VAPID_PRIVATE_KEY: "" }, net.fetchPush, NOW);
    } finally {
      console.error = original;
    }
    expect(ops).toEqual([]);
    expect(net.thumbnails).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
