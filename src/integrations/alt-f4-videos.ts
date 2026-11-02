import type { AstroIntegration } from "astro";

import { currentVideoSource, LISTED_VIDEO_IDS } from "../data/alt-f4-videos.ts";
import { OFFICIAL } from "../data/official.ts";
import { VIDEOS_PATH } from "../lib/alt-f4.ts";
import { channelFeedUrl, latestVideoIds } from "../lib/youtube-feed.ts";

const FEED_TIMEOUT_MS = 10_000;

/** チャンネルのフィードの最新の動画の ID。取れなければ null。 */
async function feedVideoIds(): Promise<string[] | null> {
  try {
    const feed = await fetch(channelFeedUrl(OFFICIAL.youtube)!, {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    return feed.ok ? latestVideoIds(await feed.text()) : null;
  } catch {
    // 通信断・タイムアウト。Worker と同じく 502 を返し、ページはチャンネルを指すウィンドウに落とす。
    return null;
  }
}

/**
 * 開発サーバー（`pnpm dev`）で、Worker（worker/index.ts）の代わりに「配信をとじろ」の動画の一覧を返す。出どころは Worker と
 * 同じ切り替え（src/data/alt-f4-videos.ts）に従う。astro dev は Worker を通さないので、無いと手元でサムネイルが出ない。
 * ビルドには効かない。Astro のエンドポイントにしないのは、ビルドに一覧のファイルが出て、本番で Worker より先に配られてしまうため。
 */
export default function altF4Videos(): AstroIntegration {
  return {
    name: "alt-f4-videos",
    hooks: {
      "astro:server:setup": ({ server }) => {
        server.middlewares.use(VIDEOS_PATH, (_request, response) => {
          void (async () => {
            const ids = currentVideoSource() === "list" ? LISTED_VIDEO_IDS : await feedVideoIds();
            response.statusCode = ids ? 200 : 502;
            response.setHeader("content-type", "application/json; charset=utf-8");
            response.end(JSON.stringify(ids ?? []));
          })();
        });
      },
    },
  };
}
