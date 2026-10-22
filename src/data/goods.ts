/**
 * グッズのページ（src/unreleased/goods.astro）に並べる、ご本人の BOOTH のお店の商品。人が BOOTH を見て書く。
 *
 * 書くのは ID・名前・カテゴリだけ。出典は、カードのリンクの行き先（商品ページ）そのもの。
 *   - id   … 商品ページの URL（`https://rurino-nemo.booth.pm/items/<id>`）の数字
 *   - name … BOOTH の商品名をそのまま
 *   - kind … BOOTH のカテゴリの名前をそのまま（「アクリルスタンド」ではなく「アクリルフィギュア」）。
 *            ページでどのグループに並ぶかも、これで決まる（`GOODS_GROUPS`）
 *
 * **画像は書かない。** ビルドのときに、商品ページの OGP の画像を取る（goods-images.ts。docs/adr/0020-booth-goods-images.md）。
 * 名前を OGP から取らないのは、取れなかったときもカードを名前で出すためと、出す文字を PR のレビューで確かめるため。
 * **価格と在庫は持たない。** 変わっても気付けず、古いまま残るため。
 *
 * 並びは BOOTH のお店の並び（新しい順）と同じ。ページではグループに分けて、グループの中はこの並びのまま出す。
 * 在庫の無いものも、お店に並んでいる限りは載せる。
 * 商品が増えた・消えたかは、定期確認で人が見る（docs/OPERATIONS.md §6）。
 */
import { OFFICIAL } from './official';

/**
 * ページで商品を分けて並べるグループと、その並び（src/unreleased/goods.astro）。
 * グループの並びは決めてあり、商品の新しさでは入れ替えない。お店でいちばん新しい商品がフィジカルグッズでも、
 * ボイスのグループの後ろに並ぶ。
 *   - kinds    … このグループに並べる BOOTH のカテゴリ。1つのカテゴリは、1つのグループにだけ書く（2つに書くと、
 *                その商品が2回並ぶ。tests/artifact/build-output.spec.ts の花の数の検査で落ちる）。
 *                グループを商品ごとに書かないのは、カテゴリと同じことを人が2か所に書くことになるため。
 *                ここに無いカテゴリの商品を BOOTH_GOODS に書くと、kind の型が合わず typecheck で止まる。新しいカテゴリは、
 *                どのグループに並べるかを決めてから足す。ボイスでも物でもない商品（壁紙などのデータ）が、黙ってフィジカルグッズに
 *                入らないように
 *   - showKind … カードにカテゴリを出すか。ボイスのグループは、カテゴリが「ボイス」だけで、見出しと同じ言葉が並ぶだけに
 *                なるので出さない。kinds を足したら、出すかを見直す
 */
export const GOODS_GROUPS = [
  { title: 'ボイス', kinds: ['ボイス'], showKind: false },
  { title: 'フィジカルグッズ', kinds: ['Tシャツ', 'アクリルフィギュア'], showKind: true },
] as const;

export interface BoothGoods {
  id: number;
  name: string;
  kind: (typeof GOODS_GROUPS)[number]['kinds'][number];
}

export const BOOTH_GOODS: readonly BoothGoods[] = [
  { id: 8543162, name: '瑠璃野ねも ジューンブライドボイス(滑り込み)', kind: 'ボイス' },
  { id: 6244428, name: '【アラーム】うるさい♪ニワトリのモノマネ目覚ましボイス【瑠璃野ねも】', kind: 'ボイス' },
  { id: 5252441, name: 'ゴミ書き順Tシャツ', kind: 'Tシャツ' },
  { id: 4046441, name: '【システムボイス】瑠璃野ねもの！とっても可憐なシステムボイス', kind: 'ボイス' },
  { id: 3744180, name: '瑠璃野ねも アクリルスタンド！(キービジュアル)', kind: 'アクリルフィギュア' },
  { id: 2870780, name: '【ボイス】瑠璃野ねもとデート ～ネモフィラの花畑編～【Vtuber】', kind: 'ボイス' },
];

/** 商品ページの URL。リンクの行き先と、OGP を取りに行く先を同じにする。 */
export function boothItemUrl(id: number): string {
  return `${OFFICIAL.booth}/items/${id}`;
}
