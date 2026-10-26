import { describe, expect, it } from "vite-plus/test";

import { OFFICIAL } from "../../src/data/official";
import { channelFeedUrl, FEED_LIMIT, latestVideoIds } from "../../src/lib/youtube-feed";

/**
 * src/lib/youtube-feed.ts — チャンネルのフィードから、広告に出す最新の動画の ID を読む（docs/adr/0033-alt-f4-thumbnails.md）。
 * 壊れると「広告にショートが出る」「同じ広告が重なる」「中継が別のチャンネルや別のホストを読む」の形で出る。
 */

const entry = (id: string, path = `/watch?v=${id}`) => `
 <entry>
  <id>yt:video:${id}</id>
  <yt:videoId>${id}</yt:videoId>
  <yt:channelId>UCnbNzG6tecF6BAdhuv_Tipg</yt:channelId>
  <title>題名 &amp; ${id}</title>
  <link rel="alternate" href="https://www.youtube.com${path}"/>
 </entry>`;

const feed = (...entries: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=UCnbNzG6tecF6BAdhuv_Tipg"/>
 <title>瑠璃野ねも</title>${entries.join("")}
</feed>`;

/** 11文字の動画の ID を、番号から作る。 */
const videoId = (n: number) => `video${String(n).padStart(6, "0")}`;

describe("チャンネルのフィードの URL", () => {
  it("公式のチャンネルの URL から、そのチャンネルのフィードを指す", () => {
    expect(channelFeedUrl(OFFICIAL.youtube)).toBe(
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCnbNzG6tecF6BAdhuv_Tipg",
    );
  });

  it("チャンネル ID の形でない URL からは作らない", () => {
    for (const url of [
      "https://www.youtube.com/@rurino_nemo",
      "https://www.youtube.com/channel/UCnbNzG6tecF6BAdhuv_Tip",
      "https://www.youtube.com/channel/XXnbNzG6tecF6BAdhuv_Tipg",
      "https://www.youtube.com/channel/UCnbNzG6tecF6BAdhuv_Tipg/videos",
      "https://example.com/channel/UCnbNzG6tecF6BAdhuv_Tipg",
      "http://www.youtube.com/channel/UCnbNzG6tecF6BAdhuv_Tipg",
      "xhttps://www.youtube.com/channel/UCnbNzG6tecF6BAdhuv_Tipg",
    ]) {
      expect(channelFeedUrl(url), url).toBeNull();
    }
  });
});

describe("最新の動画の ID", () => {
  it("フィードの順（新しい順）に返す", () => {
    expect(latestVideoIds(feed(entry("bbbbbbbbbbb"), entry("aaaaaaaaaaa")))).toEqual([
      "bbbbbbbbbbb",
      "aaaaaaaaaaa",
    ]);
  });

  it("ショート（リンクが /shorts/）は外す", () => {
    expect(
      latestVideoIds(feed(entry("aaaaaaaaaaa"), entry("bbbbbbbbbbb", "/shorts/bbbbbbbbbbb"))),
    ).toEqual(["aaaaaaaaaaa"]);
  });

  it("動画の ID の形でないもの（長さ・使えない字）と、無いものは外す", () => {
    const noId = "<entry><title>ID の無い項目</title></entry>";
    expect(
      latestVideoIds(
        feed(
          entry("aaaaaaaaaa"),
          entry("aaaaaaaaaaaa"),
          entry("aaaa<aaaaaa"),
          noId,
          entry("A-_9zZ0aaaa"),
        ),
      ),
    ).toEqual(["A-_9zZ0aaaa"]);
  });

  it("同じ ID が2回あれば、1回だけ返す", () => {
    expect(latestVideoIds(feed(entry("aaaaaaaaaaa"), entry("aaaaaaaaaaa")))).toEqual([
      "aaaaaaaaaaa",
    ]);
  });

  it("フィードの外（チャンネルのリンク）にある ID らしい字は読まない", () => {
    expect(latestVideoIds(feed())).toEqual([]);
    expect(latestVideoIds("<yt:videoId>aaaaaaaaaaa</yt:videoId>")).toEqual([]);
  });

  it(`多くても ${FEED_LIMIT} 件までにする`, () => {
    expect(FEED_LIMIT).toBe(15);
    const ids = Array.from({ length: FEED_LIMIT + 3 }, (_, i) => videoId(i));
    expect(latestVideoIds(feed(...ids.map((id) => entry(id))))).toEqual(ids.slice(0, FEED_LIMIT));
  });

  it("外したショートは件数に数えない", () => {
    const ids = Array.from({ length: FEED_LIMIT }, (_, i) => videoId(i));
    const short = entry("shortshort0", "/shorts/shortshort0");
    expect(latestVideoIds(feed(short, ...ids.map((id) => entry(id))))).toEqual(ids);
  });
});
