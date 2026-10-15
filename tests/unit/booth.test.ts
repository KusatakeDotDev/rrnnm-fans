import { describe, expect, it } from 'vitest';

import { boothItemImage } from '../../src/lib/booth';

/**
 * src/lib/booth.ts — BOOTH の商品ページの OGP から、リンクカードに出す画像を読む
 * （docs/adr/0020-booth-goods-images.md「商品ページの OGP の画像を、リンクカードの中で出す」）。
 *
 * 画像はビルドのときに取るので、dist に出たものは tests/artifact/build-output.spec.ts も見る。
 * こちらは、取った HTML がどんな形でも、条件に合わない URL を通さないことを見る。
 */

const ID = 8543162;
const IMAGE = `https://booth.pximg.net/c/620x620/f239bdde-7000-4017-bb51-575d1b5fccc9/i/${ID}/cb2171a1-dba6-457f-ac28-c5e8788d3ffe_base_resized.jpg`;

/** BOOTH の商品ページの head の並び（2026-10-10 の実物から、要るところだけ）。 */
const page = (ogImage: string) => `<!DOCTYPE html><html><head>
<meta name="twitter:image" content="https://booth.pximg.net/c/1200x630_a3_g5_bffffff/f239bdde-7000-4017-bb51-575d1b5fccc9/i/${ID}/twitter.jpg">
<meta property="og:type" content="product">
<meta property="og:title" content="瑠璃野ねも ジューンブライドボイス(滑り込み) - 瑠璃野ねものお店 - BOOTH">
${ogImage}
<meta property="og:url" content="https://rurino-nemo.booth.pm/items/${ID}">
</head><body></body></html>`;

describe('docs/adr/0020 — og:image を読む', () => {
  it('BOOTH の商品ページの形から、og:image の URL を返す', () => {
    expect(boothItemImage(page(`<meta property="og:image" content="${IMAGE}">`), ID)).toBe(IMAGE);
  });

  it('属性の順番が逆でも読む', () => {
    expect(boothItemImage(page(`<meta content="${IMAGE}" property="og:image">`), ID)).toBe(IMAGE);
  });

  it('一重引用符・大文字の属性名・自己終了の形でも読む', () => {
    expect(boothItemImage(page(`<META PROPERTY='og:image' CONTENT='${IMAGE}' />`), ID)).toBe(IMAGE);
  });

  it('= の前後に空白があっても読む', () => {
    expect(boothItemImage(page(`<meta property = "og:image" content =\n"${IMAGE}">`), ID)).toBe(IMAGE);
  });

  it.each([
    ['二重引用符', `<meta data-x="a>b" property="og:image" content="${IMAGE}">`],
    ['一重引用符', `<meta data-x='a>b' property="og:image" content="${IMAGE}">`],
  ])('%sの属性値の中に > があっても、そこでタグを切らない', (_, tag) => {
    expect(boothItemImage(page(tag), ID)).toBe(IMAGE);
  });

  it('値の &amp; は & に戻す', () => {
    expect(boothItemImage(page(`<meta property="og:image" content="${IMAGE}?a=1&amp;b=2">`), ID)).toBe(`${IMAGE}?a=1&b=2`);
  });

  it('og:image が無ければ null（twitter:image では代えない）', () => {
    expect(boothItemImage(page(''), ID)).toBeNull();
  });

  it('og:image に content が無ければ null', () => {
    expect(boothItemImage(page('<meta property="og:image">'), ID)).toBeNull();
  });

  it('最初の og:image だけを見る。合わなくても、2つめは探さない', () => {
    const other = IMAGE.replace('booth.pximg.net', 'example.com');
    const html = page(`<meta property="og:image" content="${other}">\n<meta property="og:image" content="${IMAGE}">`);
    expect(boothItemImage(html, ID)).toBeNull();
  });

  it.each(['</head>', '</HEAD >'])('%s より後ろの og:image は読まない', (end) => {
    expect(boothItemImage(`<html><head><title>x</title>${end}\n<body><meta property="og:image" content="${IMAGE}"></body>`, ID)).toBeNull();
  });

  it.each([
    ['コメント', `<!-- <meta property="og:image" content="https://example.com/i/${ID}/a.jpg"> -->`],
    ['script', `<SCRIPT type="x">document.write('<meta property="og:image" content="https://example.com/i/${ID}/a.jpg">')</SCRIPT >`],
    ['noscript', `<noscript><meta property="og:image" content="https://example.com/i/${ID}/a.jpg"></noscript>`],
  ])('%sの中の og:image は飛ばし、ページの og:image を読む', (_, before) => {
    expect(boothItemImage(page(`${before}\n<meta property="og:image" content="${IMAGE}">`), ID)).toBe(IMAGE);
  });

  it.each([
    ['script の文字列の中の </head>', `<script>document.write('</head>')</script>`],
    ['コメントの中の </head>', '<!-- </head> -->'],
    ['空のコメント <!-->', '<!-->'],
    ['空のコメント <!--->', '<!--->'],
    ['script の文字列の中の <!--', `<script>var s = '<!--';</script>`],
    ['コメントの中の <script', '<!-- <script> -->'],
    ['--!> で閉じたコメント', '<!-- x --!>'],
  ])('og:image の前に %s があっても、ページの og:image を読む', (_, before) => {
    // 後ろに --> と </script> を置く。コメントやスクリプトの終わりを探し過ぎると、ページの og:image まで外してしまう形。
    expect(boothItemImage(page(`${before}\n<meta property="og:image" content="${IMAGE}">\n<!-- x -->\n<script></script>`), ID)).toBe(IMAGE);
  });

  it('og:image の前に、ほかの meta があっても飛ばして読む', () => {
    expect(boothItemImage(`<meta charset="utf-8"><meta property="og:image" content="${IMAGE}">`, ID)).toBe(IMAGE);
  });
});

describe('docs/adr/0020 — 通す画像の条件', () => {
  it.each([
    ['別のホスト', IMAGE.replace('https://booth.pximg.net', 'https://example.com')],
    ['http', IMAGE.replace('https://', 'http://')],
    ['booth.pximg.net で始まる別のホスト', IMAGE.replace('booth.pximg.net', 'booth.pximg.net.example.com')],
    ['ユーザー情報に booth.pximg.net を入れた別のホスト', IMAGE.replace('booth.pximg.net', 'booth.pximg.net@example.com')],
    ['URL として読めない', 'not a url'],
    ['相対パス', `/c/620x620/i/${ID}/a.jpg`],
  ])('%s は通さない', (_, url) => {
    expect(boothItemImage(page(`<meta property="og:image" content="${url}">`), ID)).toBeNull();
  });

  it('別の商品の画像は通さない', () => {
    expect(boothItemImage(page(`<meta property="og:image" content="${IMAGE}">`), 6244428)).toBeNull();
  });

  it('ID が前方で一致するだけの別の商品の画像は通さない（/i/<id>/ の区切りで見る）', () => {
    expect(boothItemImage(page(`<meta property="og:image" content="${IMAGE}">`), 854316)).toBeNull();
  });

  it('ID がパスではなくクエリにあるだけなら通さない', () => {
    const url = `https://booth.pximg.net/c/620x620/x.jpg?p=/i/${ID}/`;
    expect(boothItemImage(page(`<meta property="og:image" content="${url}">`), ID)).toBeNull();
  });
});
