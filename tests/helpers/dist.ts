import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { coversAny, fontFaceRules, onlyFontFaces, withoutFontFaces } from '../../src/lib/font-face';

/**
 * ビルド成果物（dist/）を走査するヘルパー。
 *
 * 規約テストは**ルートを列挙しない**。dist に出た HTML を全部拾って、
 * そのそれぞれに対して同じ不変条件を回す。ページが増えたらテストも自動で増える。
 * これが「サイト全体にかかる規約」を無保守で守る唯一の形（→ docs/adr/0003-testing-and-ci.md）。
 */
export const DIST = path.resolve(process.env['TEST_DIST'] ?? fileURLToPath(new URL('../../dist', import.meta.url)));

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? allFiles(p) : [p];
  });
}

function assertDistExists(): void {
  if (!existsSync(DIST)) {
    throw new Error('dist/ が無い。先に `pnpm build` を実行する。');
  }
}

/** dist の中の全ファイルの絶対パス。 */
export function distFiles(): string[] {
  assertDistExists();
  return allFiles(DIST).sort();
}

/** dist の HTML のパスを URL パスに直す。例: dist/songs/index.html → /songs/ */
export function toRoute(file: string): string {
  const rel = path.relative(DIST, file).split(path.sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  return `/${rel.replace(/\.html$/, '')}`;
}

/**
 * 固定応答（tests/fixtures/build-fetch.mjs）で作ったビルドか。Release の配布前の検査は、同じ spec を実データのビルドに回すので、
 * 外の調子で変わることは、固定応答のビルドでだけ落とす。
 */
export function fixtureBuild(): boolean {
  return JSON.parse(readFileSync(`${DIST}.receipt.json`, 'utf8')).kind === 'success';
}

/** dist に出た HTML を URL パスに直したもの。例: dist/songs/index.html → /songs/ */
export function builtRoutes(): string[] {
  return builtPages().map(({ route }) => route);
}

/** dist の中身をテキストとして読む。バイナリは除く（画像はそもそも置かない方針）。 */
export function distTextFiles(): { path: string; rel: string; text: string }[] {
  const textExtensions = ['.html', '.js', '.mjs', '.css', '.json', '.txt', '.xml', '.svg', ''];
  return distFiles()
    .filter((f) => textExtensions.includes(path.extname(f)))
    .map((f) => ({
      path: f,
      rel: path.relative(DIST, f).split(path.sep).join('/'),
      text: readFileSync(f, 'utf8'),
    }));
}

/**
 * gzip 後のバイト数。**予算は転送量で測るので、生のサイズではなくこちらを使う**
 * （→ docs/adr/0006-performance-budget.md）。
 *
 * level 9 に固定するのは、zlib の既定が変わっても測り方がぶれないようにするため。
 * 実際に配るのは Cloudflare（brotli）なので、ここで出る数字は**上振れ側の近似**になる。
 */
export function gzipSize(input: string | Buffer): number {
  return gzipSync(input, { level: 9 }).length;
}

/** dist に出た HTML を、URL パスとファイルパスの対で返す。 */
export function builtPages(): { route: string; file: string }[] {
  const pages = distFiles()
    .filter((f) => f.endsWith('.html'))
    .map((file) => ({ route: toRoute(file), file }));

  if (pages.length === 0) {
    throw new Error('dist/ に HTML が1枚も無い。ビルドが壊れている。');
  }
  return pages.sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * トップの畑が、素材を使うときに JS で取りに行くファイル（`dist/field/` の `.bin`）のバイト数。
 * docs/adr/0009-nemophila-field-hero.md「花の3Dモデル」。
 *
 * HTML から参照されないので、ページの初期転送量（routeAssets）には入らない。別に測る。
 * 生のバイト数。`.bin` は配信時に圧縮される保証が無い（application/octet-stream は
 * 圧縮しない CDN が多い）ので、gzip 後で数えると予算が甘い側に外れる。拡張子で絞るのは、ブラウザが
 * 取りに行かない注記のファイルを数えないため。
 */
export function fieldAssetBytes(): { rel: string; bytes: number }[] {
  return distFiles()
    .filter((f) => path.relative(DIST, f).split(path.sep)[0] === 'field')
    .filter((f) => f.endsWith('.bin'))
    .map((f) => ({
      rel: path.relative(DIST, f).split(path.sep).join('/'),
      bytes: statSync(f).size,
    }));
}

/** 参照を URL として解決するときの仮のオリジン。これと違うオリジンに解決されたら別ホスト。 */
export const PAGE_ORIGIN = 'https://dist.invalid';

/**
 * HTML の参照（href / src）を dist の中のファイルに解決する。
 *
 * **解決できなかったものを黙って捨てない。** 捨てるとその分が 0 バイトとして数えられ、
 * 予算だけが静かに甘くなる。
 *   - dist の中を指すのに実在しない → throw。パスの組み立てかビルドが壊れている
 *   - 別ホストを指す → `external` に返す。dist に無いのでバイト数は取れないが、
 *     **測れていないこと**を予算側で落とせるようにする
 *   - `data:` → 何もしない。中身は HTML に埋まっていて、HTML の gzip に入っている
 *
 * 判定は前置き一致ではなく URL の解決に任せる。`//cdn.example/x.css` は `/` で始まるが
 * 別ホストで、`startsWith('/')` で見ると dist のパスに化ける。
 */
function resolveRefs(file: string, refs: string[], base = new URL(toRoute(file), PAGE_ORIGIN)): { local: string[]; external: string[] } {
  const local: string[] = [];
  const external: string[] = [];

  for (const ref of refs) {
    const url = new URL(ref, base);
    if (url.protocol === 'data:') continue;
    if (url.origin !== PAGE_ORIGIN) {
      external.push(ref);
      continue;
    }
    // dist のパスを URL の形に直すのではなく、URL を dist のパスに直して実在を見る。
    // path.join は先頭の `/` を区切りとして扱い、Windows の区切り文字にも揃える。
    const resolved = path.join(DIST, url.pathname);
    if (!existsSync(resolved)) {
      throw new Error(`${ref} が dist に無い（${resolved}）: ${file}`);
    }
    local.push(resolved);
  }
  return { local, external };
}

/**
 * 開始タグと属性は**正規表現リテラルで**書く。
 *
 * 3つ理由がある。
 *   1. `<link rel href>` の順を前提に1本の正規表現で書くと、順序が入れ替わった瞬間に
 *      CSS を数え落とす。例外は出ず**予算が静かに甘くなるだけ**なので、ADR-0003 §5 の
 *      「検査するトークンが静かに減る」と同じ事故になる。タグと属性を分けて拾う。
 *   2. `new RegExp('\b' + name + …)` のように文字列から組み立てると、`\b` が
 *      正規表現の単語境界ではなく**バックスペース文字**に化ける事故が起きる。
 *      リテラルなら書いたものがそのまま正規表現になる。
 *   3. 属性名の前は `\b` ではなく**空白で区切る**。`\b` はハイフンの後ろにも立つので、
 *      `\bsrc=` は `data-src=` にも当たる。インラインの `<script>` を外部参照と
 *      取り違えて、その中身を JS 予算から落とす。
 */
const TAG = {
  link: /<link\b([^>]*)>/gi,
  script: /<script\b([^>]*)>/gi,
  scriptWithBody: /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
};
const ATTR = {
  rel: /(?:^|\s)rel=["']([^"']*)["']/i,
  href: /(?:^|\s)href=["']([^"']*)["']/i,
  media: /(?:^|\s)media=["']([^"']*)["']/i,
  src: /(?:^|\s)src=["']([^"']*)["']/i,
  /** 値の書き方を問わず src 属性があるか。上の `src` で値を拾えない形を、インラインと取り違えないため。 */
  hasSrc: /(?:^|\s)src(?=\s*=|\s|$)/i,
  /** 値は引用符があっても無くても読む（`type=application/ld+json` もブラウザはデータとして扱う）。 */
  jsonType: /(?:^|\s)type\s*=\s*["']?[^"'\s>]*json/i,
};

/**
 * script の属性から、実行されない JSON（データの埋め込み）かを見る。性能予算（インラインの JS から外す）と
 * tests/artifact/build-output.spec.ts（JS の中の語を見ない）が、同じ読み方をするためにここに置く。
 */
export function isJsonScript(attrs: string): boolean {
  return ATTR.jsonType.test(attrs);
}

/** 開始タグの属性の並びを返す。 */
function tagAttrs(html: string, tag: RegExp): string[] {
  return [...html.matchAll(tag)].map(([, attrs = '']) => attrs);
}

/**
 * テキストの中の `<script src>` の値。性能予算（`routeAssets`）と、外部スクリプトの許可ホストの検査
 * （tests/artifact/build-output.spec.ts）が、同じ読み方をするためにここに置く。
 * **src があるのに値を拾えないものは throw する**（引用符の無い値など）。黙って飛ばすと、そのスクリプトが
 * 予算からも許可ホストの検査からも静かに消える。`where` はエラーに出す場所の名前。
 */
export function scriptSrcs(text: string, where: string): string[] {
  return tagAttrs(text, TAG.script)
    .filter((a) => ATTR.hasSrc.test(a))
    .map((a) => {
      const value = ATTR.src.exec(a)?.[1];
      if (value === undefined) throw new Error(`script の src を拾えない（属性: ${a.trim()}）: ${where}`);
      return value;
    });
}

/**
 * ページが読む CSS（インラインの `<style>` と `<link rel="stylesheet">` の中身）を、文書の順に返す。
 * レイヤーの順は名前が最初に出た順で決まるので、並びを変えずに返す（tests/artifact/css-layers.spec.ts）。
 * `<noscript>` の中は、JS が無いときに同じ CSS を読ませるためのものなので除く。別ホストの CSS は中身を読めないので throw する。
 */
export function pageStyles(file: string): string[] {
  const html = readFileSync(file, 'utf8').replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, '');
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>|<link\b([^>]*)>/gi)].flatMap(([, body, attrs = '']) => {
    if (body !== undefined) return [body];
    if (!(ATTR.rel.exec(attrs)?.[1] ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) return [];
    const href = ATTR.href.exec(attrs)?.[1];
    if (href === undefined) throw new Error(`stylesheet の href を拾えない（属性: ${attrs.trim()}）: ${file}`);
    const { local, external } = resolveRefs(file, [href]);
    if (external.length > 0) throw new Error(`別ホストの CSS は、レイヤーの順を計算できない（${href}）: ${file}`);
    return local.map((css) => readFileSync(css, 'utf8'));
  });
}

const ENTITY = /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos|nbsp));/gi;
const NAMED_ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const CSS_CONTENT = /content:\s*(["'])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g;
const CSS_ESCAPE = /\\(?:([0-9a-f]{1,6})\s?|([\s\S]))/gi;

/**
 * ページが描く字（コードポイント）。webfont の予算が、当たるチャンクを数えるのに使う。
 * `<body>` のテキストと、ページの CSS の `content` の文字列を拾う。`.sr-only` の文や、幅によって隠す文も数え、
 * どの太さで描くかも見ない（どの字もすべての太さで描くとみなす）。どれも上振れ側に倒す。
 */
function pageCodePoints(html: string, css: string): Set<number> {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const text = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(ENTITY, (_, hex?: string, dec?: string, name?: string) =>
      name ? NAMED_ENTITY[name.toLowerCase()]! : String.fromCodePoint(Number.parseInt(hex ?? dec!, hex ? 16 : 10)),
    );
  const content = [...css.matchAll(CSS_CONTENT)]
    .map(([, , value = '']) =>
      value.replace(CSS_ESCAPE, (_, hex?: string, char?: string) => (hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : char!)),
    )
    .join('');
  return new Set(Array.from(text + content, (char) => char.codePointAt(0)!));
}

/**
 * 1ルートが**最初の表示までに読むもの**を、HTML から解決して返す。
 *
 * CSS の `@font-face` は、`cssGzip` に入れず `webfont` に分けて返す。webfont は、ページの字が
 * `unicode-range` に当たるチャンクだけを読むので、ページごとに辿る（→ docs/adr/0006-performance-budget.md
 * 「線の引き方」）。`<noscript>` の中の `<link>` は、JS が無いときに同じ CSS を読ませるためのものなので数えない。
 */
export function routeAssets(file: string): {
  htmlGzip: number;
  /** `@font-face` を除いた CSS。 */
  cssGzip: number;
  jsGzip: number;
  /**
   * ページの字が当たるチャンク（生）と、それを並べた `@font-face` の CSS（gzip 後）。
   * `blockingFaces` は、描画を止める CSS（`media="print"` で後から当てるもの以外）にある、`url()` で読む面の数。
   */
  webfont: { cssGzip: number; files: { rel: string; bytes: number }[]; blockingFaces: number };
  /** 別ホストの CSS・JS・webfont。dist に無いので上の数字に入っていない（→ ADR-0006「別ホストの CSS・JS は測れない」）。 */
  external: string[];
} {
  const html = readFileSync(file, 'utf8');

  // 属性の拾い方が壊れると、その CSS・JS が 0 バイトになり**予算だけが静かに甘くなる**。
  // 「あるのに値を拾えない」は必ず不具合なので、1件ずつ throw する。
  const valueOf = (attrs: string, attr: RegExp, what: string): string => {
    const value = attr.exec(attrs)?.[1];
    if (value === undefined) throw new Error(`${what} を拾えない（属性: ${attrs.trim()}）: ${file}`);
    return value;
  };

  const stylesheetLinks = tagAttrs(html.replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, ''), TAG.link).filter((a) =>
    (ATTR.rel.exec(a)?.[1] ?? '').toLowerCase().split(/\s+/).includes('stylesheet'),
  );
  const hrefs = (links: string[]): string[] => links.map((a) => valueOf(a, ATTR.href, 'stylesheet の href'));
  const css = resolveRefs(file, hrefs(stylesheetLinks));
  // media="print" で読み、読み終えてから全部の画面に当てる CSS（Base.astro の webfont）は、描画を止めない。
  const isPrint = (a: string): boolean => ATTR.media.exec(a)?.[1]?.trim().toLowerCase() === 'print';
  const deferred = new Set(resolveRefs(file, hrefs(stylesheetLinks.filter(isPrint))).local);
  const js = resolveRefs(file, scriptSrcs(html, file));

  // インラインの <script> も JS 予算に入れる。JSON（データの埋め込み）は実行されないので除く。
  const inlineJs = [...html.matchAll(TAG.scriptWithBody)]
    .filter(([, attrs = '']) => !ATTR.hasSrc.test(attrs) && !isJsonScript(attrs))
    .map(([, , body = '']) => body)
    .join('\n');

  const sumGzip = (files: string[]): number => files.reduce((total, f) => total + gzipSize(readFileSync(f)), 0);

  const stylesheets = css.local.map((f) => ({ file: f, text: readFileSync(f, 'utf8') }));
  const siteCss = stylesheets.map(({ text }) => withoutFontFaces(text));
  const fontFaceCss = stylesheets.map(({ text }) => onlyFontFaces(text)).join('');
  const blockingFaces = stylesheets
    .filter(({ file: cssFile }) => !deferred.has(cssFile))
    .flatMap(({ text }) => fontFaceRules(text))
    .filter((rule) => rule.url !== null).length;
  const codePoints = pageCodePoints(html, siteCss.join('\n'));

  // url() は CSS のファイルの場所から解決する。同じチャンクを2つの面が指していても1回だけ数える。
  const fontFiles = new Set<string>();
  const fontExternal: string[] = [];
  for (const { file: cssFile, text } of stylesheets) {
    const base = new URL(path.relative(DIST, cssFile).split(path.sep).join('/'), `${PAGE_ORIGIN}/`);
    const urls = fontFaceRules(text)
      .filter((rule) => rule.url !== null && coversAny(rule.unicodeRange, codePoints))
      .map((rule) => rule.url!);
    const fonts = resolveRefs(cssFile, urls, base);
    fonts.local.forEach((f) => fontFiles.add(f));
    fontExternal.push(...fonts.external);
  }

  return {
    htmlGzip: gzipSize(html),
    cssGzip: siteCss.reduce((total, text) => total + gzipSize(text), 0),
    jsGzip: sumGzip(js.local) + (inlineJs.trim() === '' ? 0 : gzipSize(inlineJs)),
    webfont: {
      cssGzip: fontFaceCss === '' ? 0 : gzipSize(fontFaceCss),
      files: [...fontFiles].sort().map((f) => ({ rel: path.relative(DIST, f).split(path.sep).join('/'), bytes: statSync(f).size })),
      blockingFaces,
    },
    external: [...css.external, ...js.external, ...fontExternal],
  };
}
