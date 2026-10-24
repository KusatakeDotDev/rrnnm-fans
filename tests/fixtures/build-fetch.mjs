import { readFileSync } from "node:fs";

// 固定応答はテスト用ビルドの Node プロセスだけで使い、アプリには分岐を持ち込まない。
if (process.env.TEST_BUILD_SCENARIO !== "success") {
  throw new Error("固定応答のシナリオが不明");
}
// BOOTH の不調で、関係ない PR の CI が落ちないよう、商品ページにも固定の HTML を返す（RRNNM-42）。
// 1件目は 200 でない応答、2件目は og:image の無い応答にして、取れなかったときの分岐もビルドの中で通す。
// goods.ts は拡張子の無い import を持ち、ここから読み込めないので、ID を文字で拾う。
const [missingId, noImageId] = [
  ...readFileSync(new URL("../../src/data/goods.ts", import.meta.url), "utf8").matchAll(
    /\bid: (\d+),/g,
  ),
].map((m) => Number(m[1]));
const boothPage = (id) =>
  `<!doctype html><html><head><meta property="og:image" content="https://booth.pximg.net/c/620x620/fixture/i/${id}/fixture_base_resized.jpg"></head><body></body></html>`;

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : (input.url ?? input));
  if (url.protocol !== "http:" && url.protocol !== "https:") return realFetch(input, init);
  // signal が無い取得は、相手が詰まるとビルドを止め続ける。例外は取得の側の catch に飲まれてフォールバックで通るので、プロセスごと終える。
  if (!init?.signal) {
    console.error(`固定応答: signal の無い取得 ${url.href}`);
    process.exit(1);
  }
  if (url.origin === "https://www.youtube.com" && url.pathname === "/oembed") {
    const id = new URL(url.searchParams.get("url")).searchParams.get("v");
    return Response.json({
      title: "固定データの配信スケジュール",
      author_name: "テスト用チャンネル",
      provider_name: "YouTube",
      thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      thumbnail_width: 480,
      thumbnail_height: 360,
    });
  }
  if (url.origin === "https://i.ytimg.com") {
    if (init?.method !== "HEAD") throw new Error("固定buildで想定外の画像取得");
    return new Response(null, { headers: { "content-length": "20000" } });
  }
  const item =
    url.origin === "https://rurino-nemo.booth.pm" && /^\/items\/(\d+)$/.exec(url.pathname);
  if (item) {
    const id = Number(item[1]);
    if (id === missingId) return new Response("", { status: 404 });
    if (id === noImageId)
      return new Response("<!doctype html><html><head></head><body></body></html>");
    return new Response(boothPage(id));
  }
  // 応答を決めていない外への取得は、テスト用ビルドの結果を外の調子に左右させるので、プロセスごと終える。
  console.error(`固定応答: 応答を決めていない外への取得 ${url.href}`);
  process.exit(1);
};
