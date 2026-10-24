import { describe, expect, it } from "vite-plus/test";

import { isOEmbed, isYouTubeThumbnail, oembedUrl } from "../../src/lib/youtube";

/**
 * src/lib/youtube.ts — oEmbed の応答の読み方と、表紙として受け入れる URL
 * （docs/adr/0008-playlist-carousel.md「名前と表紙は、ブラウザで取る」）。
 *
 * 再生リストの名前と表紙はブラウザで取る。**ブラウザで取り直した表紙は dist に出ないので
 * 層3（build-output.spec.ts）には映らない。** 「YouTube の画像しか入れない」を
 * 機械が見ているのは、ここだけになる。
 */

describe("docs/adr/0008 §名前と表紙 — oEmbed のリクエスト先", () => {
  it("対象の URL を1つのクエリ値として埋める（? や = を割らない）", () => {
    expect(oembedUrl("https://www.youtube.com/playlist?list=PLabc")).toBe(
      "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fplaylist%3Flist%3DPLabc&format=json",
    );
  });
});

describe("docs/adr/0008 §名前と表紙 — oEmbed の応答の形", () => {
  const valid = {
    title: "ASMR",
    provider_name: "YouTube",
    thumbnail_url: "https://i.ytimg.com/vi/KVwbNd8LDPo/hqdefault.jpg",
    thumbnail_width: 480,
    thumbnail_height: 360,
  };
  const fields = Object.keys(valid) as (keyof typeof valid)[];

  it("必須の5項目が揃っていれば読む。ほかの項目があっても構わない", () => {
    expect(isOEmbed(valid)).toBe(true);
    expect(isOEmbed({ ...valid, author_name: "瑠璃野ねも", html: "<iframe></iframe>" })).toBe(true);
  });

  it.each(fields)("%s が欠けていたら読まない", (field) => {
    const partial: Record<string, unknown> = { ...valid };
    delete partial[field];
    expect(isOEmbed(partial)).toBe(false);
  });

  it.each(fields)("%s の型が違ったら読まない", (field) => {
    const wrongType = typeof valid[field] === "string" ? 1 : "1";
    expect(isOEmbed({ ...valid, [field]: wrongType })).toBe(false);
  });

  it.each([null, undefined, "ASMR", 1, []])("オブジェクトでない %j は読まない", (value) => {
    expect(isOEmbed(value)).toBe(false);
  });
});

describe("docs/adr/0008 §名前と表紙 — 表紙として受け入れるのは YouTube が配信する画像だけ", () => {
  it("https://i.ytimg.com の画像は通す", () => {
    expect(isYouTubeThumbnail("https://i.ytimg.com/vi/KVwbNd8LDPo/hqdefault.jpg")).toBe(true);
  });

  it.each([
    ["http で来た", "http://i.ytimg.com/vi/KVwbNd8LDPo/hqdefault.jpg"],
    ["別のサブドメイン", "https://i9.ytimg.com/vi/KVwbNd8LDPo/hqdefault.jpg"],
    ["i.ytimg.com で始まる別のホスト", "https://i.ytimg.com.example.com/vi/x/hqdefault.jpg"],
    [
      "ユーザー情報に i.ytimg.com を入れた別のホスト",
      "https://i.ytimg.com@example.com/vi/x/hqdefault.jpg",
    ],
    [
      "パスに i.ytimg.com を含む別のホスト",
      "https://example.com/https://i.ytimg.com/vi/x/hqdefault.jpg",
    ],
    ["ポートが違う", "https://i.ytimg.com:8443/vi/x/hqdefault.jpg"],
    ["スキームの無い URL", "//i.ytimg.com/vi/x/hqdefault.jpg"],
    ["URL でない文字列", "hqdefault.jpg"],
    ["空文字", ""],
  ])("%s は通さない", (_, url) => {
    expect(isYouTubeThumbnail(url)).toBe(false);
  });
});
