/**
 * 公式アカウントのURL。docs/FACTS.md §2 / Issue rurino-nemo-fansite#24。全ページのフッターから出す（docs/CONCEPT.md §4 柱9）。
 */
export const OFFICIAL = {
  /**
   * ハンドル（`@rurino_nemo`）ではなくチャンネルIDで指す。ハンドルは本人がいつでも変えられ、リンクが黙って死ぬため。
   * チャンネルIDの URL は今のハンドルへ転送される。
   */
  youtube: "https://www.youtube.com/channel/UCnbNzG6tecF6BAdhuv_Tipg",
  x: "https://x.com/rurino_nemo",
  marshmallow: "https://marshmallow-qa.com/rurino_nemo",

  /** チャンネル概要欄に本人がリンクしている（docs/FACTS.md §2）。 */
  booth: "https://rurino-nemo.booth.pm",

  /** チャンネル概要欄には無い。ご本人の X の納品のポストが、ここの作品を指している（docs/FACTS.md §2）。 */
  skeb: "https://skeb.jp/@rurino_nemo",
} as const;
