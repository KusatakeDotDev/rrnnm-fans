/**
 * グッズのページのリンクカードに出す画像を、ビルドのときに BOOTH の商品ページの OGP から取る
 * （docs/adr/0020-booth-goods-images.md）。src/unreleased/goods.astro が使う。
 *
 * 読み方と、`<img>` に入れてよい URL の条件は src/lib/booth.ts にある。
 *
 * **取れなかった商品は、画像を `null` にしてビルドを続ける。** ネットワークの不調・タイムアウト・商品の削除・
 * OGP の形の変化のどれでも、カードは名前と花の下地で出る。CI の検査のビルドは BOOTH を固定応答で取るので
 * （tests/fixtures/build-fetch.mjs）、そこで画像が1枚も出なくなったら tests/artifact/build-output.spec.ts が落ちる。
 * 本物の BOOTH から1枚も取れなかったときは、Release は止めずに注意を出し（scripts/verify-release.mjs）、プレビューのビルドは
 * 検査を通らないので何も出ない（docs/adr/0020-booth-goods-images.md「払うもの」。定期確認で人が見る）。
 *
 * 取った結果は、このモジュールが生きている間だけ持つ。開発サーバーでページを開き直すたびに、BOOTH へ取りに行かないため。
 * ただし、1枚も取れなかったときは持たず、次に開いたときに取り直す。通信が切れていたときの花だけのカードが、
 * 開発サーバーを立て直すまで残らないように。
 *
 * 取りに行く形は schedule-oembed.ts と同じだが、共通の関数にはしない。取れなかったときの落ち方が
 * 違い（予定のカードは1件まるごとリンクに落ち、こちらは商品ごとに画像だけを落とす）、共通にする分が少ないため。
 */
import { boothItemImage } from '../lib/booth';
import { BOOTH_GOODS, boothItemUrl, type BoothGoods } from './goods';

// BOOTH 側の応答が詰まった場合に astro build がブロックされ続けないための上限（schedule-oembed.ts と同じ）。
const FETCH_TIMEOUT_MS = 5_000;

export interface BoothGoodsCard extends BoothGoods {
  /** 商品ページの URL。 */
  url: string;
  /** 商品ページの OGP の画像。取れなかった・条件に合わなかったら `null`。 */
  image: string | null;
}

/**
 * 取れなかったときは、理由をビルドのログに出す。画像が出なくなったとき（Release が注意を出したときなど）に、
 * BOOTH が弾いたのか（HTTP の状態）、届かなかったのか（例外）、ページの形が変わったのか（og:image が読めない）を
 * ログで見分けられるように。
 */
async function fetchImage(id: number): Promise<string | null> {
  const url = boothItemUrl(id);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[goods] ${url} の画像を取れなかった: HTTP ${res.status}`);
      // 本文は読まないので捨てる。読まずに置くと、接続が GC まで残る。捨てるのに失敗しても（本文がもう失敗していた
      // など）、理由は上の HTTP の状態なので、下の catch へは回さない（同じ商品に2行目のログを出さない）。
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const image = boothItemImage(await res.text(), id);
    if (image === null) console.warn(`[goods] ${url} の og:image が無いか、条件に合わない`);
    return image;
  } catch (error) {
    // ビルド環境のネットワーク不調・タイムアウトなど。画像の無いカードに落ちる。
    // Node の fetch は、届かなかった理由（名前解決・接続・TLS）を cause に入れ、本体は「fetch failed」とだけ言う。
    // oxlint-disable-next-line typescript/no-base-to-string -- cause は Node の fetch が入れる Error で、String で名前と理由が出る
    const cause =error instanceof Error && error.cause !== undefined ? `（${String(error.cause)}）` : '';
    console.warn(`[goods] ${url} の画像を取れなかった: ${String(error)}${cause}`);
    return null;
  }
}

async function fetchGoods(): Promise<BoothGoodsCard[]> {
  return Promise.all(
    BOOTH_GOODS.map(async (item) => ({ ...item, url: boothItemUrl(item.id), image: await fetchImage(item.id) })),
  );
}

let cached: Promise<BoothGoodsCard[]> | null = null;

/** BOOTH の商品を、並びはそのままに、画像を添えて返す。1枚でも取れたら、そのあとは取りに行かない。 */
export function getBoothGoods(): Promise<BoothGoodsCard[]> {
  return (cached ??= fetchGoods().then((goods) => {
    if (goods.every((item) => item.image === null)) cached = null;
    return goods;
  }));
}
