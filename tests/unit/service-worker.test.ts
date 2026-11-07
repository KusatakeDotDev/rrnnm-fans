import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import sharp from "sharp";
import { describe, expect, it } from "vite-plus/test";

import {
  NOTIFICATION_BODY,
  NOTIFICATION_TITLE,
  NOTIFICATION_URL,
  NOTIFY_PAGE,
  SERVICE_WORKER_PATH,
} from "../../src/data/notify";
import { handle } from "../../worker/index";
import type { NotifyEnv } from "../../worker/notify";
import { SERVICE_WORKER_SOURCE } from "../../worker/service-worker";

/**
 * worker/service-worker.ts — 配信スケジュールの更新の通知を受ける Service Worker（docs/adr/0035-schedule-push-notifications.md）。
 * 壊れると「設定のページを出す前に Service Worker を配る」「push を受けても通知を出さない（Safari が許可を取り消す）」
 * 「通知を押しても今週の配信予定が開かない」「ページのリクエストを横取りする」の形で出る。
 */

const ORIGIN = "https://rrnnm.fans";

function env(pages: readonly string[]): NotifyEnv {
  return {
    ASSETS: {
      fetch: async (input) => {
        const url = new URL(typeof input === "string" ? input : input.url);
        return pages.includes(url.pathname)
          ? new Response("page", { status: 200 })
          : new Response("not found", { status: 404 });
      },
    },
    NOTIFY: new Proxy({} as NotifyEnv["NOTIFY"], {
      get: () => () => {
        throw new Error("Service Worker を返すのに KV を使った");
      },
    }),
    NOTIFY_WORKFLOW: new Proxy({} as NotifyEnv["NOTIFY_WORKFLOW"], {
      get: () => () => {
        throw new Error("Service Worker を返すのに Workflow を使った");
      },
    }),
  };
}

describe("Service Worker を返す", () => {
  it("設定のページがあるビルドでは、決まったパスで JavaScript を返し、途中に覚えさせない", async () => {
    const response = await handle(
      new Request(`${ORIGIN}${SERVICE_WORKER_PATH}`),
      env([NOTIFY_PAGE]),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toBe(SERVICE_WORKER_SOURCE);
  });

  it("設定のページが無いビルドでは返さず、静的なファイルの 404 にする", async () => {
    const response = await handle(new Request(`${ORIGIN}${SERVICE_WORKER_PATH}`), env([]));
    expect(response.status).toBe(404);
  });

  it("GET・HEAD 以外は 405", async () => {
    const response = await handle(
      new Request(`${ORIGIN}${SERVICE_WORKER_PATH}`, { method: "POST" }),
      env([NOTIFY_PAGE]),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});

/** Service Worker の中身を、作り物の `self` の上で動かす。受けたイベントの種類と、呼ばれたものを記録する。 */
function install() {
  const listeners = new Map<string, (event: unknown) => void>();
  const calls: unknown[][] = [];
  const self = {
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    skipWaiting: () => calls.push(["skipWaiting"]),
    registration: {
      showNotification: async (...args: unknown[]) =>
        void calls.push(["showNotification", ...args]),
    },
    clients: { openWindow: async (url: string) => void calls.push(["openWindow", url]) },
  };
  // ブラウザと同じく、ほかの名前の無いところで動かす。`self` のほかに頼っているものがあれば、ここで落ちる。
  runInNewContext(SERVICE_WORKER_SOURCE, { self });
  const dispatch = async (type: string, extra: object = {}) => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
      ...extra,
    });
    await Promise.all(waits);
    return waits.length;
  };
  return { listeners, calls, dispatch };
}

describe("Service Worker の中身", () => {
  it("受けるのは install・push・notificationclick だけで、ページのリクエスト（fetch）は受けない", () => {
    expect([...install().listeners.keys()].sort()).toEqual([
      "install",
      "notificationclick",
      "push",
    ]);
  });

  it("新しいバージョンは、待たずに入れ替える", async () => {
    const { calls, dispatch } = install();
    await dispatch("install");
    expect(calls).toEqual([["skipWaiting"]]);
  });

  it("push を受けたら、中身が無くても、決まった文の通知を出し終えるまで待たせる", async () => {
    const { calls, dispatch } = install();
    expect(await dispatch("push", { data: null })).toBe(1);
    expect(calls).toEqual([
      [
        "showNotification",
        NOTIFICATION_TITLE,
        {
          body: NOTIFICATION_BODY,
          icon: "/favicon-192.png",
          badge: "/badge.png",
          lang: "ja",
          tag: "schedule",
          renotify: true,
        },
      ],
    ]);
  });

  // 画像が無くても通知は出て、既定のアイコンに替わるだけなので、パスの書き違いに気づけない。
  it("通知のアイコンとバッジの画像が public/ にあり、バッジは形の外が透けている", async () => {
    const { calls, dispatch } = install();
    await dispatch("push", { data: null });
    const { icon, badge } = calls[0]![2] as { icon: string; badge: string };
    for (const image of [icon, badge]) {
      expect(existsSync(new URL(`../../public${image}`, import.meta.url)), image).toBe(true);
    }
    const { data } = await sharp(fileURLToPath(new URL(`../../public${badge}`, import.meta.url)))
      .ensureAlpha()
      .extractChannel("alpha")
      .raw()
      .toBuffer({ resolveWithObject: true });
    // favicon（背景の四角が不透明で、透けているのは角だけ）を渡すと、4% ほどしか透けていない。
    const transparent = data.filter((alpha) => alpha === 0).length / data.length;
    expect(transparent, "透明な画素が半分に満たない").toBeGreaterThan(0.5);
    expect(data.includes(255), "不透明な画素が無い").toBe(true);
  });

  // 🧚 に ZWJ と ♀ を続けると、ご本人が使う女性の妖精（🧚‍♀️）になり、ご本人が喋っているように読める（src/data/notify.ts）。
  it("通知の本文の妖精は、ご本人が使う女性の妖精にしない", () => {
    expect(NOTIFICATION_BODY).toContain("\u{1F9DA}");
    expect(NOTIFICATION_BODY).not.toContain("\u{1F9DA}‍♀");
  });

  it("通知を押したら、通知を閉じ、トップの今週の配信予定を開く", async () => {
    const { calls, dispatch } = install();
    let closed = false;
    expect(
      await dispatch("notificationclick", { notification: { close: () => (closed = true) } }),
    ).toBe(1);
    expect(closed).toBe(true);
    expect(calls).toEqual([["openWindow", NOTIFICATION_URL]]);
    expect(NOTIFICATION_URL).toBe("/#schedule");
  });
});
