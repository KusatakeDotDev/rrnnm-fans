import { describe, expect, it } from "vite-plus/test";

import { currentVideoSource, LISTED_VIDEO_IDS } from "../../src/data/alt-f4-videos";
import { CELEBRATION_ENDS_AT, VIDEOS_PATH } from "../../src/lib/alt-f4";
import { channelFeedUrl } from "../../src/lib/youtube-feed";
import { OFFICIAL } from "../../src/data/official";
import { type Env, type FeedFetch, handle } from "../../worker/index";

/**
 * worker/index.ts — 「配信をとじろ」の動画の一覧だけを返し、ほかは静的なファイルに回す（docs/adr/0033-alt-f4-thumbnails.md）。
 * 壊れると「Worker が無かったときと 404 が変わる」「未公開のあいだの本番で一覧を返す」「YouTube の不調がページに素通しになる」
 * 「特別仕様のあいだかどうかと違う一覧を返す」「特別仕様が終わっても、一覧をブラウザに覚えさせたままにする」の形で出る。
 */

const ORIGIN = "https://rrnnm.fans";
/** 登録者10万人の記念の特別仕様のあいだ（リポジトリの一覧を返す）と、終わったあと（フィードを返す）の時刻。 */
const DURING = CELEBRATION_ENDS_AT - 60 * 60 * 1000;
const AFTER = CELEBRATION_ENDS_AT;
const FEED = "https://feed.example/videos.xml";

const xml = (...ids: string[]) =>
  `<feed>${ids
    .map(
      (id) =>
        `<entry><yt:videoId>${id}</yt:videoId><link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/></entry>`,
    )
    .join("")}</feed>`;

/** 一覧のパスでは KV を使わない。使ったら落とす。 */
const unusedKv: Env["NOTIFY"] = new Proxy({} as Env["NOTIFY"], {
  get: (_, name) => () => {
    throw new Error(`一覧のパスで KV の ${String(name)} を呼んだ`);
  },
});

/** 一覧のパスでは Workflow を使わない。使ったら落とす。 */
const unusedWorkflow: Env["NOTIFY_WORKFLOW"] = new Proxy({} as Env["NOTIFY_WORKFLOW"], {
  get: (_, name) => () => {
    throw new Error(`一覧のパスで Workflow の ${String(name)} を呼んだ`);
  },
});

/** 静的なファイル。`pages` にあるパスは 200、ほかは 404。受けたリクエストの URL を記録する。 */
function assets(pages: readonly string[]) {
  const requested: string[] = [];
  const env: Env = {
    ASSETS: {
      fetch: async (input) => {
        const url = new URL(typeof input === "string" ? input : input.url);
        requested.push(url.pathname);
        return pages.includes(url.pathname)
          ? new Response("page", { status: 200 })
          : new Response("not found", { status: 404 });
      },
    },
    NOTIFY: unusedKv,
    NOTIFY_WORKFLOW: unusedWorkflow,
    YOUTUBE_FEED_URL: FEED,
  };
  return { env, requested };
}

function feedFetch(response: () => Response | Promise<Response>) {
  const calls: { url: string; init: Parameters<FeedFetch>[1] }[] = [];
  const fetchFeed: FeedFetch = async (url, init) => {
    calls.push({ url, init });
    return response();
  };
  return { fetchFeed, calls };
}

const get = (path: string) => new Request(`${ORIGIN}${path}`);

describe("一覧のパスの外", () => {
  it("静的なファイルに回し、その応答（404 も）をそのまま返す", async () => {
    const { env, requested } = assets(["/play/alt-f4/"]);
    const { fetchFeed, calls } = feedFetch(() => new Response(xml()));
    const response = await handle(get("/no-such-page/"), env, fetchFeed);
    expect(response.status).toBe(404);
    expect(requested).toEqual(["/no-such-page/"]);
    expect(calls).toEqual([]);
  });
});

describe("一覧のパス", () => {
  it("ページとスクリプトが同じパスを見る（ゲームのページの下）", () => {
    expect(VIDEOS_PATH).toBe("/play/alt-f4/videos.json");
  });

  it.each([
    ["特別仕様のあいだ", DURING],
    ["特別仕様が終わったあと", AFTER],
  ])(
    "ゲームのページが無いビルド（未公開のあいだの本番）では、一覧を返さず静的なファイルの 404 にする（%s）",
    async (_, now) => {
      const { env, requested } = assets([]);
      const { fetchFeed, calls } = feedFetch(() => new Response(xml("aaaaaaaaaaa")));
      const response = await handle(get(VIDEOS_PATH), env, fetchFeed, now);
      expect(response.status).toBe(404);
      expect(requested).toEqual(["/play/alt-f4/", VIDEOS_PATH]);
      expect(calls).toEqual([]);
    },
  );

  it("時刻を渡さなければ、今の時刻の出どころ（src/data/alt-f4-videos.ts）に従う", async () => {
    const { env } = assets(["/play/alt-f4/"]);
    const { fetchFeed } = feedFetch(() => new Response(xml("aaaaaaaaaaa")));
    const response = await handle(get(VIDEOS_PATH), env, fetchFeed);
    expect(await response.json()).toEqual(
      currentVideoSource() === "list" ? LISTED_VIDEO_IDS : ["aaaaaaaaaaa"],
    );
  });
});

describe("今の出どころ", () => {
  it("登録者10万人の記念の特別仕様のあいだはリポジトリの一覧、終わったらフィード", () => {
    expect(currentVideoSource(CELEBRATION_ENDS_AT - 1)).toBe("list");
    expect(currentVideoSource(CELEBRATION_ENDS_AT)).toBe("feed");
  });
});

describe("特別仕様のあいだは、リポジトリの一覧", () => {
  it("一覧の全部を JSON で返し、10分覚えさせる。フィードは読まず、ほかのオリジンには開かない", async () => {
    const { env } = assets(["/play/alt-f4/"]);
    const { fetchFeed, calls } = feedFetch(() => new Response(xml("aaaaaaaaaaa")));
    const response = await handle(get(VIDEOS_PATH), env, fetchFeed, DURING);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(LISTED_VIDEO_IDS);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=600");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("終わる時刻の10分前を過ぎたら、終わる時刻までしか覚えさせない", async () => {
    const { env } = assets(["/play/alt-f4/"]);
    const { fetchFeed } = feedFetch(() => new Response(xml()));
    const response = await handle(get(VIDEOS_PATH), env, fetchFeed, CELEBRATION_ENDS_AT - 90_500);
    expect(response.headers.get("cache-control")).toBe("public, max-age=90");
  });

  it("一覧は、重ならない11文字の動画の ID だけ", () => {
    expect(LISTED_VIDEO_IDS.length).toBeGreaterThan(0);
    for (const id of LISTED_VIDEO_IDS) expect(id).toMatch(/^[\w-]{11}$/);
    expect(new Set(LISTED_VIDEO_IDS).size).toBe(LISTED_VIDEO_IDS.length);
  });
});

describe("特別仕様が終わったら、フィード", () => {
  it("フィードの最新の動画の ID を JSON で返し、10分覚えさせる。ほかのオリジンには開かない", async () => {
    const { env } = assets(["/play/alt-f4/"]);
    const { fetchFeed, calls } = feedFetch(() => new Response(xml("bbbbbbbbbbb", "aaaaaaaaaaa")));
    const response = await handle(get(VIDEOS_PATH), env, fetchFeed, AFTER);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(["bbbbbbbbbbb", "aaaaaaaaaaa"]);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=600");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(calls).toEqual([{ url: FEED, init: { cf: { cacheTtl: 600, cacheEverything: true } } }]);
  });

  it("中継する先を書かなければ、公式のチャンネルのフィードを読む", async () => {
    const { env } = assets(["/play/alt-f4/"]);
    const { fetchFeed, calls } = feedFetch(() => new Response(xml()));
    await handle(get(VIDEOS_PATH), { ...env, YOUTUBE_FEED_URL: "" }, fetchFeed, AFTER);
    expect(calls.map((call) => call.url)).toEqual([channelFeedUrl(OFFICIAL.youtube)]);
  });

  it("フィードがエラーを返したら、502 と空の一覧にし、1分だけ覚えさせる", async () => {
    const { env } = assets(["/play/alt-f4/"]);
    const { fetchFeed } = feedFetch(() => new Response("", { status: 500 }));
    const response = await handle(get(VIDEOS_PATH), env, fetchFeed, AFTER);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual([]);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("フィードに繋がらなければ、502 と空の一覧にする", async () => {
    const { env } = assets(["/play/alt-f4/"]);
    const { fetchFeed } = feedFetch(() => Promise.reject(new TypeError("fetch failed")));
    const response = await handle(get(VIDEOS_PATH), env, fetchFeed, AFTER);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual([]);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });
});
