import type { AstroIntegration } from "astro";

import { OFFICIAL } from "../data/official.ts";
import { VIDEOS_PATH } from "../lib/alt-f4.ts";
import { channelFeedUrl, latestVideoIds } from "../lib/youtube-feed.ts";

const FEED_TIMEOUT_MS = 10_000;

/**
 * 開発サーバー（`pnpm dev`）で、Worker（worker/index.ts）の代わりに「広告をとじろ」の動画の一覧を返す。
 * astro dev は Worker を通さないので、無いと手元でサムネイルが出ない。ビルドには効かない。
 * Astro のエンドポイントにしないのは、ビルドに一覧のファイルが出て、本番で Worker より先に配られてしまうため。
 */
export default function altF4Videos(): AstroIntegration {
  return {
    name: "alt-f4-videos",
    hooks: {
      "astro:server:setup": ({ server }) => {
        server.middlewares.use(VIDEOS_PATH, (_request, response) => {
          void (async () => {
            let ids: string[] | null = null;
            try {
              const feed = await fetch(channelFeedUrl(OFFICIAL.youtube)!, {
                signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
              });
              if (feed.ok) ids = latestVideoIds(await feed.text());
            } catch {
              // 通信断・タイムアウト。Worker と同じく 502 を返し、ページはチャンネルへの広告に落とす。
            }
            response.statusCode = ids ? 200 : 502;
            response.setHeader("content-type", "application/json; charset=utf-8");
            response.end(JSON.stringify(ids ?? []));
          })();
        });
      },
    },
  };
}
