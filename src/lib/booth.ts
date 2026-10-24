/**
 * BOOTH の商品ページの HTML から、グッズのページのリンクカードに出す画像の URL を読む
 * （docs/adr/0020-booth-goods-images.md「商品ページの OGP の画像を、リンクカードの中で出す」）。
 *
 * fetch はしない。ここは純関数だけの層（docs/adr/0003-testing-and-ci.md §2）。取りに行くのは
 * src/data/goods-images.ts。
 */

/** ADR-0020 の例外が掛かるのは、BOOTH が配信する画像だけ。 */
const IMAGE_ORIGIN = "https://booth.pximg.net";

/** 引用符の中の `>` では、タグを切らない（HTML では属性値に `>` をそのまま書ける）。 */
const META = /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const ATTR = /\s([a-z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * 商品ページの HTML の og:image が、商品 `itemId` の画像として `<img>` に入れてよい URL なら返す。
 * og:image が無い・URL として読めない・条件に合わないなら `null`。
 *
 * 条件は2つ。
 *   - **BOOTH の画像のホスト（`https://booth.pximg.net`）。** 文字列の前方一致で見ず、URL として解釈して
 *     オリジンを比べる（src/lib/youtube.ts の `isYouTubeThumbnail` と同じ。`https://booth.pximg.net.example.com/`
 *     のような URL を通さないため）。`isYouTubeThumbnail` と共通の関数にはしない。
 *     重なるのは、URL を解釈してオリジンを比べる数行だけで、モジュールをまたいで共通にするほどではないため
 *   - **パスに、その商品の ID の区切り（`/i/<id>/`）がある。** BOOTH の商品の画像は、どれもこの形のパスを持つ
 *     （2026-10-10 に6件で確かめた）。ID を取り違えて、ほかの商品の画像を出さないため
 *
 * 探すのは `</head>` より前だけで、`<script>`・`<noscript>` とコメントの中は外す（`headOf`）。
 * そのうえで、最初の og:image だけを見る。合わなくても、2つめ以降は探さない。
 * 属性の値は `&amp;` だけを戻す。BOOTH の画像の URL に、ほかの文字参照になる文字は入らない。
 */
export function boothItemImage(html: string, itemId: number): string | null {
  for (const [tag] of headOf(html).matchAll(META)) {
    const attrs = new Map<string, string>();
    // 引用符で包んだ値だけを読む。BOOTH の meta は二重引用符で書いてある。
    // 型の上では m[2] は string だが、一重引用符の値のときは undefined になる。
    for (const m of tag.matchAll(ATTR)) {
      attrs.set(m[1].toLowerCase(), m[2] ?? m[3]);
    }
    if (attrs.get("property") !== "og:image") continue;
    const content = attrs.get("content");
    if (content === undefined) return null;
    return acceptImage(content.replaceAll("&amp;", "&"), itemId);
  }
  return null;
}

/**
 * `</head>` より前を返す。`</head>` が無ければ全体。`<script>`・`<noscript>` とコメントの中は外す。
 * スクリプトの文字列やコメントに書かれた `<meta>` や `</head>` を、ページのものとして読まないため。
 *
 * コメントとスクリプトは、1本の正規表現で前から読み、先に出たほうを外す。HTML の読み方の細かい決まり（閉じていない
 * コメントやスクリプト、スクリプトの中の `<!--<script` など）までは追わない。そうした形で読み違えても、商品の ID と
 * ホストで確かめるので、別の商品の画像は出ない（花のカードに落ちる）。
 * どちらかを先に全部外すと、コメントの中の `<script` や、スクリプトの文字列の中の `<!--` を始まりと取り違え、
 * 後ろのページの og:image まで一緒に外してしまう。`</head>` を探すのは、外したあと。
 * コメントは、HTML と同じく `<!-->`・`<!--->` と、`--!>` でも閉じたものとして読む。
 */
function headOf(html: string): string {
  const stripped = html.replace(
    /<!--(?:-?>|[\s\S]*?--!?>)|<(script|noscript)\b[\s\S]*?<\/\1\s*>/gi,
    // Stryker disable next-line StringLiteral: コメントと script・noscript はタグの外にしか無いので、外した跡に何を置いても、読む <meta> と </head> は変わらない
    "",
  );
  const end = stripped.search(/<\/head\s*>/i);
  return end === -1 ? stripped : stripped.slice(0, end);
}

function acceptImage(value: string, itemId: number): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // URL として解釈できない文字列。
    return null;
  }
  if (url.origin !== IMAGE_ORIGIN) return null;
  if (!url.pathname.includes(`/i/${itemId}/`)) return null;
  return url.href;
}
