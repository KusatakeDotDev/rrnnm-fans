/**
 * サイトの Worker。ミニゲーム「配信をとじろ」の動画の一覧（VIDEOS_PATH。ADR-0033 の決定）と、配信スケジュールの更新の通知の
 * 購読（SUBSCRIPTIONS_PATH）と Service Worker（SERVICE_WORKER_PATH）と Cron（ADR-0035 の決定。中身は worker/notify.ts）を受け持ち、ほかは静的なファイル（dist）に回す。
 * 一覧は、src/data/alt-f4-videos.ts の切り替え（登録者10万人の記念の特別仕様のあいだかどうか）で、
 * リポジトリに置いた一覧か、チャンネルのフィードの最新を返す。
 * フィードは CORS を許さず、ブラウザから読めないので、同じオリジンで中継する。
 * ほかのサイトのページから読ませないよう、`Access-Control-Allow-Origin` は付けない（CORS が止めるのはブラウザだけで、
 * ブラウザの外からは読めるが、返すのはこのチャンネルの公開の動画の ID だけ）。
 */
import { currentVideoSource, LISTED_VIDEO_IDS } from "../src/data/alt-f4-videos";
import { SERVICE_WORKER_PATH, SUBSCRIPTIONS_PATH } from "../src/data/notify";
import { OFFICIAL } from "../src/data/official";
import { maxAgeUntilCelebrationEnds, VIDEOS_PATH } from "../src/lib/alt-f4";
import { channelFeedUrl, latestVideoIds } from "../src/lib/youtube-feed";
import { handleServiceWorker, handleSubscriptions, type NotifyEnv, runCron } from "./notify";

export interface Env extends NotifyEnv {
  /** 中継するフィード。空ならチャンネルのフィード。テストでは、外へ出ない先に替える（playwright.config.ts）。 */
  YOUTUBE_FEED_URL?: string;
}

/** Cloudflare の端でフィードを覚えておく指定（Workers の fetch だけが読む）。 */
type FeedInit = RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } };
export type FeedFetch = (url: string, init: FeedInit) => Promise<Response>;

/** ゲームのページ。未公開のあいだ（ADR-0018）は本番のビルドに無いので、一覧も返さない。 */
const GAME_PAGE = "/play/alt-f4/";
/**
 * 一覧を覚えさせる間（秒）。フィードは、開く人ごとに YouTube へ取りに行かないため、この間をおいて取り直す。新しい動画は、
 * 最大でこれだけ遅れて出る。リポジトリの一覧は、特別仕様が終わる時刻を越えては覚えさせない。
 */
const LIST_TTL_S = 600;
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
  now: number = Date.now(),
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === SUBSCRIPTIONS_PATH) return handleSubscriptions(request, env);
  if (url.pathname === SERVICE_WORKER_PATH) return handleServiceWorker(request, env);
  // 静的なファイルが無いリクエストだけがここへ来る。Worker が無かったときと同じ 404 にするため、ASSETS に返させる。
  if (url.pathname !== VIDEOS_PATH) return env.ASSETS.fetch(request);
  const page = await env.ASSETS.fetch(new URL(GAME_PAGE, url).href);
  await page.body?.cancel();
  if (!page.ok) return env.ASSETS.fetch(request);
  if (currentVideoSource(now) === "list") {
    return videoList(LISTED_VIDEO_IDS, 200, maxAgeUntilCelebrationEnds(now, LIST_TTL_S));
  }
  try {
    const feed = await fetchFeed(env.YOUTUBE_FEED_URL || channelFeedUrl(OFFICIAL.youtube)!, {
      cf: { cacheTtl: LIST_TTL_S, cacheEverything: true },
    });
    if (!feed.ok) return videoList([], 502, ERROR_TTL_S);
    return videoList(latestVideoIds(await feed.text()), 200, LIST_TTL_S);
  } catch {
    return videoList([], 502, ERROR_TTL_S);
  }
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
  scheduled: (
    _controller: unknown,
    env: Env,
    context: { waitUntil(promise: Promise<unknown>): void },
  ) => context.waitUntil(runCron(env)),
};
