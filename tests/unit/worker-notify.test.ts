import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { NOTIFY_PAGE, SUBSCRIPTIONS_PATH, VAPID_SUBJECT } from "../../src/data/notify";
import { HQ_URL } from "../../src/data/schedule";
import { base64url, fromBase64url } from "../../src/lib/web-push";
import { handle } from "../../worker/index";
import {
  DELIVERY_RETENTION,
  deliver,
  deliveryId,
  type DeliveryWorkflow,
  type NotifyEnv,
  type NotifyKv,
  PAGE_SIZE,
  PUSH_CONCURRENCY,
  PUSH_TTL_S,
  runCron,
  SEND_STEP,
  SUBSCRIPTION_PREFIX,
  STATE_KEY,
} from "../../worker/notify";

/**
 * worker/notify.ts — 配信スケジュールの更新の通知の、購読の受け付けと、Cron と、送る処理の Workflow の中身
 * （docs/adr/0035-schedule-push-notifications.md）。壊れると「設定のページを出す前に購読を受け付ける」「ほかのサイトから購読を
 * 足される」「差し替わっても送らない／差し替わっていないのに送る」「同じ画像に戻ったときに送り直す」「1人の失敗で、ほかの人に
 * 届かない」「同じ人に二重に送る」「やめた人に送り続ける」「push のサービスが署名を受け付けない」の形で出る。
 */

const ORIGIN = "https://rrnnm.fans";
const NOW = Date.parse("2026-11-05T12:00:00Z");
const APPLE = "https://web.push.apple.com/abc";
const FCM = "https://fcm.googleapis.com/fcm/send/abc";

/**
 * Workers KV と同じく、キーの名前の順に並べ、`limit` 件ずつカーソルで続きを返す。操作の数も数える。
 * カーソルは、最後に返したキーの名前で、その次から返す。KV では、消したキーも一覧の中で順番を保ったまま辿られ、返されない
 * だけ（Cloudflare の KV の list のドキュメント）なので、ページの途中で消しても、続きは飛ばされない。
 */
function memoryKv(initial: Record<string, { value: string; metadata?: unknown }> = {}) {
  const store = new Map(Object.entries(initial));
  const ops: string[] = [];
  const kv: NotifyKv = {
    get: async (key) => {
      ops.push(`get ${key}`);
      return store.get(key)?.value ?? null;
    },
    getWithMetadata: async (key) => {
      ops.push(`get ${key}`);
      const entry = store.get(key);
      return { value: entry?.value ?? null, metadata: entry?.metadata ?? null };
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
      const names = [...store.keys()]
        .filter((name) => name.startsWith(prefix) && (!cursor || name > cursor))
        .sort();
      const keys = names
        .slice(0, limit)
        .map((name) => ({ name, metadata: store.get(name)!.metadata }));
      return names.length > limit
        ? { keys, list_complete: false, cursor: keys.at(-1)!.name }
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
  const thumbnailUrls: string[] = [];
  const fetchPush = async (url: string, init: RequestInit) => {
    if (url.split("?")[0] === HQ_URL) {
      thumbnails.push(init);
      thumbnailUrls.push(url);
      return thumbnail();
    }
    pushes.push({ url, init });
    return new Response(null, { status: pushStatus(url) });
  };
  return { fetchPush, pushes, thumbnails, thumbnailUrls };
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

  it("宛先の URL は整えてから置く（足すときと消すときで、同じキーになる）", async () => {
    const { env: e, store } = env();
    const raw = "https://WEB.push.apple.com:443/x/../abc";
    expect((await handle(subscribe("POST", { endpoint: raw }), e)).status).toBe(204);
    expect([...store]).toEqual([[subscriptionKey(APPLE), { value: "", metadata: APPLE }]]);
    expect((await handle(subscribe("DELETE", { endpoint: raw }), e)).status).toBe(204);
    expect(store.size).toBe(0);
  });

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

const image = (text: string) => () => new Response(text, { status: 200 });

/** Workflows のバインディングの代わり。`existing` と作ったインスタンスだけが残っていて、`get` はそれだけを返す。 */
function memoryWorkflow(log: string[], existing: readonly string[] = []) {
  const ids = new Set(existing);
  const created: Parameters<DeliveryWorkflow["create"]>[0][] = [];
  const workflow: DeliveryWorkflow = {
    get: async (id) => {
      if (!ids.has(id)) throw new Error("instance not found");
      return {};
    },
    create: async (options) => {
      if (ids.has(options.id)) throw new Error("instance already exists");
      log.push(`create ${options.id}`);
      ids.add(options.id);
      created.push(options);
      return {};
    },
  };
  return { workflow, created };
}

/** console.error を拾う。送れなかった宛先は、ログに残して先へ進むため。 */
function captureErrors() {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => calls.push(args);
  return { calls, restore: () => (console.error = original) };
}

describe("Cron", () => {
  const cronEnv = (initial: Parameters<typeof memoryKv>[0] = {}, existing: string[] = []) => {
    const { kv, store, ops } = memoryKv(initial);
    const { workflow, created } = memoryWorkflow(ops, existing);
    const env: NotifyEnv = {
      ...assets([]),
      NOTIFY: kv,
      NOTIFY_WORKFLOW: workflow,
      VAPID_PRIVATE_KEY: "key",
    };
    const run = (fetchThumbnail: Parameters<typeof runCron>[1], now = NOW) =>
      runCron(env, fetchThumbnail, now);
    return { env, store, ops, created, run };
  };
  /** 前回見たサムネイルが `text`。 */
  const seen = (text: string) => ({
    [STATE_KEY]: { value: JSON.stringify({ hash: sha256(text) }) },
  });
  const stateOf = (store: Map<string, { value: string }>) =>
    JSON.parse(store.get(STATE_KEY)!.value);

  it("状態のキーの名前は、ハッシュを取る画像を表す（画像を替えたら、キーも替えて覚え直しから始める）", () => {
    const image = new URL(HQ_URL).pathname
      .split("/")
      .at(-1)!
      .replace(/\.jpg$/, "");
    expect(STATE_KEY).toBe(`state:${image}`);
  });

  it("初めて見たサムネイルは、ハッシュを覚えるだけで、送る処理を始めない", async () => {
    const { store, created, run } = cronEnv(subscribed(APPLE));
    await run(network(image("week-1")).fetchPush);
    expect(stateOf(store)).toEqual({ hash: sha256("week-1") });
    expect(created).toEqual([]);
  });

  it("サムネイルは、Cloudflare のエッジに覚えさせたものを読まない", async () => {
    const { run } = cronEnv();
    const net = network(image("week-1"));
    await run(net.fetchPush);
    expect(net.thumbnails).toEqual([{ cache: "no-store" }]);
  });

  it("サムネイルは、回ごとに違うクエリを付けて取り、YouTube のエッジに残った差し替える前の画像を読まない", async () => {
    const { run } = cronEnv();
    const net = network(image("week-1"));
    await run(net.fetchPush, NOW);
    await run(net.fetchPush, NOW + 5 * 60_000);
    expect(net.thumbnailUrls).toEqual([`${HQ_URL}?t=${NOW}`, `${HQ_URL}?t=${NOW + 5 * 60_000}`]);
  });

  it("前回と同じなら、何も書かず、送る処理を始めない", async () => {
    const { ops, created, run } = cronEnv(seen("week-1"));
    await run(network(image("week-1")).fetchPush);
    expect(ops).toEqual([`get ${STATE_KEY}`]);
    expect(created).toEqual([]);
  });

  it.each([
    ["エラーを返した", () => new Response("", { status: 404 })],
    ["繋がらなかった", () => Promise.reject(new TypeError("fetch failed"))],
  ])(
    "サムネイルが取れなければ（%s）、ハッシュを書き換えず、送る処理を始めない",
    async (_, thumbnail) => {
      const { ops, created, run } = cronEnv(seen("week-1"));
      await run(network(thumbnail).fetchPush);
      expect(ops).toEqual([`get ${STATE_KEY}`]);
      expect(created).toEqual([]);
    },
  );

  it("差し替わったら、その画像の送る処理を始めてから、ハッシュを書き換える。Cron は push を送らない", async () => {
    const { store, ops, created, run } = cronEnv({ ...seen("week-1"), ...subscribed(APPLE) });
    const net = network(image("week-2"));
    await run(net.fetchPush);
    const hash = sha256("week-2");
    expect(created).toEqual([
      {
        id: deliveryId(hash),
        params: { hash },
        retention: { successRetention: DELIVERY_RETENTION, errorRetention: DELIVERY_RETENTION },
      },
    ]);
    expect(ops.slice(-2)).toEqual([`create ${deliveryId(hash)}`, `put ${STATE_KEY}`]);
    expect(stateOf(store)).toEqual({ hash });
    expect(net.pushes).toEqual([]);
  });

  it("インスタンスの ID は、Workflows が受け付ける形（100 文字まで、英数字・`-`・`_`）にする", () => {
    const id = deliveryId(sha256("week-2"));
    expect(id.length).toBeLessThanOrEqual(100);
    expect(id).toMatch(/^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/);
  });

  it("同じ画像のインスタンスが残っていれば（その画像に戻ったとき）、始めずに、ハッシュだけ書き換える", async () => {
    const { store, created, run } = cronEnv(seen("week-2"), [deliveryId(sha256("week-1"))]);
    await run(network(image("week-1")).fetchPush);
    expect(created).toEqual([]);
    expect(stateOf(store)).toEqual({ hash: sha256("week-1") });
  });

  it("送る処理を始められなければ、ハッシュを書き換えず、次の Cron がもう一度始める", async () => {
    const { env, store, created, run } = cronEnv(seen("week-1"));
    const workflow = env.NOTIFY_WORKFLOW;
    env.NOTIFY_WORKFLOW = { ...workflow, create: () => Promise.reject(new Error("落ちた")) };
    await expect(run(network(image("week-2")).fetchPush)).rejects.toThrow("落ちた");
    expect(stateOf(store)).toEqual({ hash: sha256("week-1") });
    env.NOTIFY_WORKFLOW = workflow;
    await run(network(image("week-2")).fetchPush);
    expect(created.map(({ id }) => id)).toEqual([deliveryId(sha256("week-2"))]);
    expect(stateOf(store)).toEqual({ hash: sha256("week-2") });
  });

  it("始めたあとにハッシュを書けなくても、次の Cron は同じ画像の送る処理を二重に始めない", async () => {
    const { env, store, created, run } = cronEnv(seen("week-1"));
    const kv = env.NOTIFY;
    env.NOTIFY = { ...kv, put: () => Promise.reject(new Error("KV が落ちた")) };
    await expect(run(network(image("week-2")).fetchPush)).rejects.toThrow("KV が落ちた");
    env.NOTIFY = kv;
    await run(network(image("week-2")).fetchPush);
    expect(created).toHaveLength(1);
    expect(stateOf(store)).toEqual({ hash: sha256("week-2") });
  });

  it("インスタンスがあるかを一時的に確かめられなくても、二重に始めず、次の Cron でハッシュを書き換える", async () => {
    const { env, store, created, run } = cronEnv(seen("week-1"), [deliveryId(sha256("week-2"))]);
    const workflow = env.NOTIFY_WORKFLOW;
    env.NOTIFY_WORKFLOW = { ...workflow, get: () => Promise.reject(new Error("一時的に落ちた")) };
    await expect(run(network(image("week-2")).fetchPush)).rejects.toThrow("already exists");
    expect(stateOf(store)).toEqual({ hash: sha256("week-1") });
    env.NOTIFY_WORKFLOW = workflow;
    await run(network(image("week-2")).fetchPush);
    expect(created).toEqual([]);
    expect(stateOf(store)).toEqual({ hash: sha256("week-2") });
  });

  it.each([["not json"], ["null"], ['{"cursor":""}'], ['{"hash":1}']])(
    "状態が読めなければ（%s）、初めて見たときと同じく、今のハッシュを覚えるだけで始めない",
    async (value) => {
      const { store, created, run } = cronEnv({ [STATE_KEY]: { value } });
      await run(network(image("week-2")).fetchPush);
      expect(stateOf(store)).toEqual({ hash: sha256("week-2") });
      expect(created).toEqual([]);
    },
  );

  it("秘密鍵が無ければ、サムネイルも見ない", async () => {
    const { env, ops } = cronEnv(seen("week-1"));
    const net = network(image("week-2"));
    const errors = captureErrors();
    try {
      await runCron({ ...env, VAPID_PRIVATE_KEY: "" }, net.fetchPush, NOW);
    } finally {
      errors.restore();
    }
    expect(ops).toEqual([]);
    expect(net.thumbnails).toEqual([]);
    expect(errors.calls).toHaveLength(1);
  });
});

// TODO(RRNNM-121): @cloudflare/vitest-pool-workers が Vitest 5 に対応したら、本物の Workflows で確かめる。
/**
 * Workflows のステップの代わり。呼ばれた順に名前と設定を覚え、結果を JSON にして返す（ステップの結果は保存されるので、
 * 保存できる形かも確かめる）。`failing` の名前のステップは、中身を動かさずに落とし、`after` は各ステップのあとに呼ぶ。
 */
function fakeStep(
  options: { failing?: readonly string[]; after?: (name: string) => void | Promise<void> } = {},
) {
  const calls: { name: string; config?: WorkflowStepConfig; result?: unknown }[] = [];
  const step = {
    do: async (name: string, ...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<unknown>;
      const call: (typeof calls)[number] = { name };
      if (args.length === 2) call.config = args[0] as WorkflowStepConfig;
      calls.push(call);
      if (options.failing?.includes(name)) throw new Error(`${name} が落ちた`);
      call.result = JSON.parse(JSON.stringify(await callback()));
      await options.after?.(name);
      return call.result;
    },
  } as WorkflowStep;
  return { step, calls };
}

describe("送る処理（Workflow）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const deliveryEnv = async (initial: Parameters<typeof memoryKv>[0] = {}) => {
    const keys = await keyPair();
    const { kv, store, ops } = memoryKv(initial);
    const env: NotifyEnv = {
      ...assets([]),
      NOTIFY: kv,
      NOTIFY_WORKFLOW: memoryWorkflow([]).workflow,
      VAPID_PRIVATE_KEY: keys.privateKey,
    };
    const run = (fetchPush: Parameters<typeof deliver>[2], step = fakeStep().step) =>
      deliver(step, env, fetchPush, keys.publicKey);
    return { env, store, ops, keys, run };
  };
  const endpoints = (count: number) =>
    Array.from({ length: count }, (_, n) => `https://web.push.apple.com/${n}`);
  const subscriptions = (store: Map<string, unknown>) =>
    [...store.keys()].filter((key) => key.startsWith(SUBSCRIPTION_PREFIX)).sort();
  /** KV のキーの順（一覧が返す順）に並べた宛先。 */
  const inKeyOrder = (urls: readonly string[]) =>
    [...urls].sort((a, b) => (subscriptionKey(a) < subscriptionKey(b) ? -1 : 1));
  const noThumbnail = () => {
    throw new Error("送る処理はサムネイルを取らない");
  };

  it("購読している全員に、中身の無い push を送る", async () => {
    const { keys, run } = await deliveryEnv(subscribed(APPLE, FCM));
    const net = network(noThumbnail);
    await run(net.fetchPush);
    expect(net.pushes.map((push) => push.url).sort()).toEqual([APPLE, FCM].sort());
    for (const { url, init } of net.pushes) {
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("manual");
      expect(init.body).toBeUndefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
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

  it(`${PAGE_SIZE} 件ずつのページにし、ページごとに一覧を読むステップと送るステップを分けて、全員に1回ずつ送る`, async () => {
    const all = endpoints(PAGE_SIZE * 2 + 3);
    const { run } = await deliveryEnv(subscribed(...all));
    const { step, calls } = fakeStep();
    const net = network(noThumbnail);
    await run(net.fetchPush, step);
    expect(calls.map(({ name }) => name)).toEqual([
      "list 0",
      "send 0",
      "list 1",
      "send 1",
      "list 2",
      "send 2",
    ]);
    expect(calls.filter(({ name }) => name.startsWith("send")).map(({ result }) => result)).toEqual(
      [
        { sent: PAGE_SIZE, gone: 0, failed: 0 },
        { sent: PAGE_SIZE, gone: 0, failed: 0 },
        { sent: 3, gone: 0, failed: 0 },
      ],
    );
    expect(net.pushes.map((push) => push.url).sort()).toEqual([...all].sort());
  });

  it("送るステップはやり直さず、一覧を読むステップは Workflows の既定のやり直しに任せる", async () => {
    const { run } = await deliveryEnv(subscribed(APPLE));
    const { step, calls } = fakeStep();
    await run(network(noThumbnail).fetchPush, step);
    expect(SEND_STEP.retries?.limit).toBe(0);
    expect(calls.map(({ name, config }) => [name, config])).toEqual([
      ["list 0", undefined],
      ["send 0", SEND_STEP],
    ]);
  });

  it("送るステップが落ちても、次のページから続けて送る", async () => {
    const all = endpoints(PAGE_SIZE + 3);
    const { run } = await deliveryEnv(subscribed(...all));
    const { step } = fakeStep({ failing: ["send 0"] });
    const net = network(noThumbnail);
    const errors = captureErrors();
    try {
      await run(net.fetchPush, step);
    } finally {
      errors.restore();
    }
    expect(net.pushes.map((push) => push.url).sort()).toEqual(
      inKeyOrder(all).slice(PAGE_SIZE).sort(),
    );
    expect(errors.calls).toHaveLength(1);
  });

  it("ステップの結果に、宛先の URL を残さない（インスタンスの状態に残るため）", async () => {
    const { run } = await deliveryEnv(subscribed(APPLE, FCM));
    const { step, calls } = fakeStep();
    await run(network(noThumbnail).fetchPush, step);
    const saved = JSON.stringify(calls.map(({ result }) => result));
    expect(saved).not.toContain(APPLE);
    expect(saved).not.toContain(FCM);
  });

  it("切れた宛先（404・410）は消し、ほかの失敗は残す", async () => {
    const all = endpoints(4);
    const codes = [404, 410, 500, 429];
    const { store, run } = await deliveryEnv(subscribed(...all));
    const { step, calls } = fakeStep();
    await run(network(noThumbnail, (url) => codes[all.indexOf(url)]!).fetchPush, step);
    expect(subscriptions(store)).toEqual(
      [subscriptionKey(all[2]!), subscriptionKey(all[3]!)].sort(),
    );
    expect(calls.at(-1)!.result).toEqual({ sent: 0, gone: 2, failed: 2 });
  });

  it.each([
    [
      "push のサービスに繋がらない",
      (net: ReturnType<typeof network>) => (url: string, init: RequestInit) =>
        url === APPLE ? Promise.reject(new TypeError("fetch failed")) : net.fetchPush(url, init),
      (env: NotifyEnv) => env,
    ],
    [
      "宛先を KV から読めない",
      (net: ReturnType<typeof network>) => net.fetchPush,
      (env: NotifyEnv): NotifyEnv => ({
        ...env,
        NOTIFY: {
          ...env.NOTIFY,
          getWithMetadata: (key) =>
            key === subscriptionKey(APPLE)
              ? Promise.reject(new Error("KV が落ちた"))
              : env.NOTIFY.getWithMetadata(key),
        },
      }),
    ],
  ])(
    "1つの宛先の失敗（%s）は、その宛先だけにとどめ、宛先を残して、ほかの宛先に送る",
    async (_, fetchFor, envFor) => {
      const { env, store, keys } = await deliveryEnv(subscribed(APPLE, FCM));
      const net = network(noThumbnail);
      const { step, calls } = fakeStep();
      const errors = captureErrors();
      try {
        await deliver(step, envFor(env), fetchFor(net), keys.publicKey);
      } finally {
        errors.restore();
      }
      expect(net.pushes.map((push) => push.url)).toEqual([FCM]);
      expect(store.has(subscriptionKey(APPLE))).toBe(true);
      expect(calls.at(-1)!.result).toEqual({ sent: 1, gone: 0, failed: 1 });
      expect(errors.calls).toHaveLength(1);
    },
  );

  it("署名の鍵が読めなくても、ステップを落とさず、宛先も消さない", async () => {
    const { env, store, keys } = await deliveryEnv(subscribed(APPLE, FCM));
    const net = network(noThumbnail);
    const { step, calls } = fakeStep();
    const errors = captureErrors();
    try {
      await deliver(step, { ...env, VAPID_PRIVATE_KEY: "AAAA" }, net.fetchPush, keys.publicKey);
    } finally {
      errors.restore();
    }
    expect(net.pushes).toEqual([]);
    expect(subscriptions(store)).toHaveLength(2);
    expect(calls.at(-1)!.result).toEqual({ sent: 0, gone: 0, failed: 2 });
  });

  it("宛先を消せなくても（KV が落ちたときなど）、ほかの宛先に送る", async () => {
    const { env, store, run } = await deliveryEnv(subscribed(APPLE, FCM));
    env.NOTIFY.delete = () => Promise.reject(new Error("KV が落ちた"));
    const net = network(noThumbnail, (url) => (url === APPLE ? 410 : 201));
    const errors = captureErrors();
    try {
      await run(net.fetchPush);
    } finally {
      errors.restore();
    }
    expect(net.pushes.map((push) => push.url).sort()).toEqual([APPLE, FCM].sort());
    expect(store.has(subscriptionKey(APPLE))).toBe(true);
    expect(errors.calls).toHaveLength(1);
  });

  it("メタデータが受け付ける宛先でない購読は、送らずに消す", async () => {
    const bad = "https://example.com/abc";
    const { store, run } = await deliveryEnv({
      [subscriptionKey(bad)]: { value: "", metadata: bad },
    });
    const net = network(noThumbnail);
    await run(net.fetchPush);
    expect(net.pushes).toEqual([]);
    expect(store.has(subscriptionKey(bad))).toBe(false);
  });

  it("転送（3xx）を返した宛先は、ほかの失敗と同じく残す", async () => {
    const { store, run } = await deliveryEnv(subscribed(APPLE));
    const net = network(noThumbnail, () => 307);
    await run(net.fetchPush);
    expect(net.pushes).toHaveLength(1);
    expect(store.has(subscriptionKey(APPLE))).toBe(true);
  });

  it("一覧を読んだあとにやめた人には、送らない", async () => {
    const { store, run } = await deliveryEnv(subscribed(APPLE, FCM));
    const { step, calls } = fakeStep({
      after: (name) => {
        if (name === "list 0") store.delete(subscriptionKey(APPLE));
      },
    });
    const net = network(noThumbnail);
    await run(net.fetchPush, step);
    expect(net.pushes.map((push) => push.url)).toEqual([FCM]);
    expect(calls.at(-1)!.result).toEqual({ sent: 1, gone: 0, failed: 0 });
  });

  it("切れた宛先をページの途中で消しても、続きのページを飛ばさない", async () => {
    const all = endpoints(PAGE_SIZE * 2 + 5);
    const { store, run } = await deliveryEnv(subscribed(...all));
    const net = network(noThumbnail, () => 410);
    await run(net.fetchPush);
    expect(net.pushes.map((push) => push.url).sort()).toEqual([...all].sort());
    expect(subscriptions(store)).toEqual([]);
  });

  it(`KV の読み出しと送信は、合わせて同時に ${PUSH_CONCURRENCY} 件まで（Workers が応答を待てる接続の数）にして、全員に送る`, async () => {
    const all = endpoints(PAGE_SIZE);
    const { env, keys } = await deliveryEnv(subscribed(...all));
    let inFlight = 0;
    let peak = 0;
    const waiting = async <T>(work: () => Promise<T>): Promise<T> => {
      peak = Math.max(peak, ++inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return await work();
      } finally {
        inFlight--;
      }
    };
    const kv = env.NOTIFY;
    const slowEnv: NotifyEnv = {
      ...env,
      NOTIFY: { ...kv, getWithMetadata: (key) => waiting(() => kv.getWithMetadata(key)) },
    };
    const net = network(noThumbnail);
    const { step, calls } = fakeStep();
    await deliver(
      step,
      slowEnv,
      (url, init) => waiting(() => net.fetchPush(url, init)),
      keys.publicKey,
    );
    expect(peak).toBe(PUSH_CONCURRENCY);
    expect(calls.at(-1)!.result).toEqual({ sent: PAGE_SIZE, gone: 0, failed: 0 });
  });

  it("購読が無ければ、送らない", async () => {
    const { run } = await deliveryEnv();
    const net = network(noThumbnail);
    await run(net.fetchPush);
    expect(net.pushes).toEqual([]);
  });

  it("秘密鍵が無ければ、ステップを始めずにインスタンスを失敗にする（画面で見えるように）", async () => {
    const { env, keys } = await deliveryEnv(subscribed(APPLE));
    const { step, calls } = fakeStep();
    await expect(
      deliver(
        step,
        { ...env, VAPID_PRIVATE_KEY: "" },
        network(noThumbnail).fetchPush,
        keys.publicKey,
      ),
    ).rejects.toThrow("VAPID_PRIVATE_KEY");
    expect(calls).toEqual([]);
  });
});
