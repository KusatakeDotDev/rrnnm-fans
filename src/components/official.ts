/**
 * 公式アカウントのURL。docs/FACTS.md §2 / Issue rurino-nemo-fansite#24。全ページのフッターから出す（docs/CONCEPT.md §4 柱9）。
 *
 * src/lib に置かない。あそこは純関数だけの層（docs/adr/0003-testing-and-ci.md §2）でミューテーションテストの対象なので、
 * 定数を置くと、テストの当てようがない文字列リテラルのミュータントが生き残ってスコアだけが下がる。
 */
export const OFFICIAL = {
  /**
   * ハンドル（`@rurino_nemo`）ではなくチャンネルIDで指す。ハンドルは本人がいつでも変えられ、リンクが黙って死ぬため。
   * チャンネルIDの URL は今のハンドルへ転送される。
   */
  youtube: 'https://www.youtube.com/channel/UCnbNzG6tecF6BAdhuv_Tipg',
  x: 'https://x.com/rurino_nemo',
  marshmallow: 'https://marshmallow-qa.com/rurino_nemo',

  /** チャンネル概要欄に本人がリンクしている（docs/FACTS.md §2）。 */
  booth: 'https://rurino-nemo.booth.pm',
} as const;
