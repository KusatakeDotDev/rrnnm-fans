/**
 * サイトの Worker。ミニゲーム「広告をとじろ」の動画の一覧（VIDEOS_PATH）だけを返し、ほかは静的なファイル（dist）に回す
 * （ADR-0033 の決定）。チャンネルのフィードは CORS を許さず、ブラウザから読めないので、同じオリジンで中継する。
 * ほかのサイトのページから読ませないよう、`Access-Control-Allow-Origin` は付けない（CORS が止めるのはブラウザだけで、
 * ブラウザの外からは読めるが、返すのはこのチャンネルの公開の動画の ID だけ）。
 */
import { OFFICIAL } from "../src/data/official";
import { VIDEOS_PATH } from "../src/lib/alt-f4";
import { channelFeedUrl, latestVideoIds } from "../src/lib/youtube-feed";

export interface Env {
  ASSETS: { fetch(input: Request | string): Promise<Response> };
  /** 中継するフィード。空ならチャンネルのフィード。テストでは、外へ出ない先に替える（playwright.config.ts）。 */
  YOUTUBE_FEED_URL?: string;
}

/** Cloudflare の端でフィードを覚えておく指定（Workers の fetch だけが読む）。 */
type FeedInit = RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } };
export type FeedFetch = (url: string, init: FeedInit) => Promise<Response>;

/** ゲームのページ。未公開のあいだ（ADR-0018）は本番のビルドに無いので、一覧も返さない。 */
const GAME_PAGE = "/play/alt-f4/";
/** フィードを取り直す間（秒）。開く人ごとに YouTube へ取りに行かないため。新しい動画は、最大でこれだけ遅れて出る。 */
const FEED_TTL_S = 600;
/** 取れなかったときに覚えさせる間（秒）。YouTube の一時的な不調から、早めに戻るため。 */
const ERROR_TTL_S = 60;

function videoList(ids: readonly string[], status: number, maxAge: number): Response {
  return new Response(JSON.stringify(ids), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
    },
  });
}

export async function handle(
  request: Request,
  env: Env,
  fetchFeed: FeedFetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  // 静的なファイルが無いリクエストだけがここへ来る。Worker が無かったときと同じ 404 にするため、ASSETS に返させる。
  if (url.pathname !== VIDEOS_PATH) return env.ASSETS.fetch(request);
  const page = await env.ASSETS.fetch(new URL(GAME_PAGE, url).href);
  await page.body?.cancel();
  if (!page.ok) return env.ASSETS.fetch(request);
  try {
    const feed = await fetchFeed(env.YOUTUBE_FEED_URL || channelFeedUrl(OFFICIAL.youtube)!, {
      cf: { cacheTtl: FEED_TTL_S, cacheEverything: true },
    });
    if (!feed.ok) return videoList([], 502, ERROR_TTL_S);
    return videoList(latestVideoIds(await feed.text()), 200, FEED_TTL_S);
  } catch {
    return videoList([], 502, ERROR_TTL_S);
  }
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
};
