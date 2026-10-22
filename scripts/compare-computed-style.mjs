/**
 * 2つのビルド（main とブランチ）の同じページを同じ条件で開き、全要素の computed style を比べる。
 *
 * docs/adr/0025-native-css-and-stylelint.md「見た目が変わらないことは、computed style を比べて確かめる」。
 * 手元では `pnpm css:compare <A> <B> [オプション]`。A が main、B がブランチ。
 *
 * <A>・<B> はビルドの出力のディレクトリか、それを配っているサーバーの URL。
 * - ディレクトリは、このスクリプトが空いているポートで配る（4321 は、ほかの worktree のサーバーにつながることがある）
 * - `iframe.html` と `index.json` があれば Storybook の出力（`pnpm build-storybook` の `storybook-static`）とみて、全 story を開く。
 *   無ければサイトの出力とみて、全ての HTML を開く。片方にしか無いページ・story は、開かずに片方にしか無いものとして出す。
 *   URL のサイトは `--paths` が要る
 * - main の側は、別の worktree で main をビルドして作る。両方を同じ仕方でビルドする（固定データは
 *   `node scripts/build.mjs success`、未公開のページも見るなら `SHOW_UNRELEASED=1`）。出力は上書きされるので、比べる前に別の場所へ写す
 *
 * オプション:
 *   --paths /,/about/      開くページを絞る（サイトはパス、Storybook は story の id）
 *   --widths 360,390       幅を差し替える。既定は 360・390・800・1280（360 は想定するいちばん狭いスマートフォン）
 *   --add-widths 599,600   既定の幅に足す（切り替わりの前後を見るときなど）
 *   --browsers chromium    既定は chromium,webkit
 *   --match id,data-x      要素を、その属性を持ついちばん近い祖先（自分を含む）と、そこからの位置で組む。
 *                          既定は DOM の中の位置で組むので、要素を足す・外す PR では、その後ろの要素がみな差に出る
 *   --ignore '.new'        その要素と子孫を比べない（くり返し書ける）
 *   --external             外への通信を止めない（/references/ の X の widgets.js が描いた後を見るときなど）
 *   --jobs 4               同時に比べる条件の数（1つの条件で2ページ開く。メモリが足りなければ減らす）
 *
 * 比べるもの: 全要素と `::before`・`::after` の、getComputedStyle の全プロパティと、ページのどこかに書かれた
 * カスタムプロパティ。標準のプロパティの差は要素ごとに、カスタムプロパティの差はプロパティの名前ごとにまとめて出す
 * （継承するので、トークンを1つ足すだけで全要素に出る）。見た目が変わらない PR で0を求めるのは、標準のプロパティの差。
 * Chromium では、`:hover` と `:focus-visible` を1つずつの要素に当てた状態も比べる（当てるのは Chrome DevTools Protocol の
 * `CSS.forcePseudoState` で、WebKit には無い）。当てる先は、フォーカスできる要素と、`:hover` のルールが指す要素で、
 * 比べるのはその要素と子孫だけ。`:has(:hover)` や `:hover + *` のように、外の要素に効く書き方は見ない。
 *
 * 条件: 幅 × Chromium・WebKit × 動きを減らす設定のあり・なし × JS のあり・なし × forced-colors のあり・なし。
 * Storybook は JS が無いと描かないので、JS なしは無い。forced-colors を当てても効かないブラウザでは、その条件を飛ばして出す。
 * ページの状態も変えて比べる: 畑（`[data-field]`）は昼・配信前・配信中、再生リスト（JS ありのとき）は畳む・広げる。
 *
 * 揺れを止めるもの: 時計（`Date`）と `Math.random` は、決まった値にしてから開く。通信が止み、移り変わりと終わりのある
 * アニメーションが終わるのを待ってから、終わりの無いアニメーションを頭で止めて測る（CSS で止めると、そのプロパティの
 * 差が見えなくなる）。書体は読まない（読み終わる前後で、幅や高さの値が変わる）。外への通信は既定で止める。
 *
 * 終了コード: 0 = 標準のプロパティの差も、片方にしか無い要素・ページも無い（カスタムプロパティの差だけなら0）。
 * 1 = どちらかがある。2 = 引数の誤り（比べるページ・story が1つも無いときを含む）か、開けなかったページ（HTTP のエラーを含む）か、
 * 読めなかった `index.json` がある。
 *
 * **CI では回さない。** 理由は ADR-0025 の同じ節。基準の値も、リポジトリに置かない。
 */
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { chromium, webkit } from 'playwright';

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      paths: { type: 'string' },
      widths: { type: 'string' },
      'add-widths': { type: 'string' },
      browsers: { type: 'string' },
      match: { type: 'string' },
      ignore: { type: 'string', multiple: true },
      external: { type: 'boolean' },
      jobs: { type: 'string' },
    },
  });
} catch (error) {
  usage(error instanceof Error ? error.message : String(error));
}
const { values: args, positionals } = parsed;

const list = (value, name) => {
  const items = value?.split(',').map((s) => s.trim()).filter(Boolean);
  // 空のリストは渡し間違いとみて止める。--paths・--widths・--browsers が空だと、一度も比べずに差0で終わるため。
  if (items?.length === 0) usage(`${name} が空（使わないなら、オプションごと外す）`);
  return items;
};
const numbers = (value, name) =>
  list(value, name)?.map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n <= 0) usage(`${name} は正の整数を , で区切って書く: ${s}`);
    return n;
  });

function usage(message) {
  console.error(message);
  console.error('使い方: pnpm css:compare <A> <B> [--paths …] [--widths …] [--add-widths …] [--browsers …] [--match …] [--ignore …] [--external] [--jobs …]');
  process.exit(2);
}

if (positionals.length !== 2) usage('比べる2つ（ディレクトリか URL）を渡す');
const BROWSERS = { chromium, webkit };
const browserNames = list(args.browsers, '--browsers') ?? ['chromium', 'webkit'];
for (const name of browserNames) if (!Object.hasOwn(BROWSERS, name)) usage(`--browsers は chromium・webkit から選ぶ: ${name}`);
const widths = [...new Set([...(numbers(args.widths, '--widths') ?? [360, 390, 800, 1280]), ...(numbers(args['add-widths'], '--add-widths') ?? [])])].sort((a, b) => a - b);
const jobs = numbers(args.jobs, '--jobs')?.[0] ?? 4;
const match = list(args.match, '--match') ?? [];
const ignore = args.ignore ?? [];

/** ページの高さ。幅だけを条件にし、高さは両方でそろえる。 */
const HEIGHT = 900;
/** 時計。日付で中身を選ぶもの（Skeb の作品）と、時刻で URL を変えるもの（予定のサムネイル）が、両方で同じになる。 */
const FIXED_TIME = new Date('2026-10-18T03:00:00Z');
/** 通信がこの長さ止んだら、ページのスクリプトが応じ終わったとみる。 */
const QUIET_MS = 300;
const POLL_MS = 50;
/** これより長く通信が止まなければ、そのページは比べられないとして出す。 */
const NETWORK_GIVE_UP_MS = 15_000;
/** アニメーションと移り変わりを待つ上限。超えた分は settle で終わらせる。 */
const ANIMATION_GIVE_UP_MS = 5_000;
/** `:hover`・`:focus-visible` を当てる要素に付けるマーカー。ページの CSS が使わない名前にする。 */
const MARK = 'data-css-compare-target';

// ---- 配る ----

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/** ディレクトリなら空いているポートで配り、その URL を返す。URL ならそのまま返す。 */
function serve(target) {
  if (/^https?:\/\//.test(target)) return Promise.resolve({ base: target.replace(/\/$/, ''), dir: null, close() {} });
  const dir = resolve(target);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) usage(`ディレクトリが無い: ${target}`);
  const server = createServer((req, res) => {
    let file = join(dir, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    if (relative(dir, file).startsWith('..')) return void res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      const notFound = join(dir, '404.html');
      if (!existsSync(notFound)) return void res.writeHead(404).end();
      return void res.writeHead(404, { 'content-type': TYPES['.html'] }).end(readFileSync(notFound));
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done({ base: `http://127.0.0.1:${server.address().port}`, dir, close: () => server.close() })));
}

async function readJson(side, path) {
  try {
    if (side.dir) return existsSync(join(side.dir, path)) ? JSON.parse(readFileSync(join(side.dir, path), 'utf8')) : null;
    const res = await fetch(`${side.base}/${path}`);
    return res.ok ? await res.json() : null;
  } catch (error) {
    // 比べる前に落ちると終了コードが 1 になり、「差がある」と見分けられない。
    console.error(`${side.dir ?? side.base} の ${path} を読めなかった: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}

/** サイトの出力の全 HTML を、開くパスにする（`about/index.html` → `/about/`）。 */
function sitePaths(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) {
        const rel = relative(dir, full).split(sep).join('/');
        out.push(`/${rel.endsWith('index.html') ? rel.slice(0, -'index.html'.length) : rel}`);
      }
    }
  };
  walk(dir);
  return out.sort();
}

// ---- ページの中で動かす ----

/**
 * ページの中で動かす関数（Playwright が文字列にして渡すので、外の変数を使わない）。
 * - settle: アニメーションを止め、移り変わりを終わらせる
 * - read: 比べる要素の computed style を全部読む。index があれば、マーカーの付いた index 番目の要素と子孫を、
 *   settle してから読む。props（読むプロパティの名前の JSON）を渡されなければ、ページから集める。
 *   値は数十万になり、そのまま渡すと Node との行き来で詰まるので、縮めて JSON の文字列にして返す
 * - mark: `:hover`・`:focus-visible` を当てる要素にマーカーを付け、その一覧を返す
 * - unmark: マーカーを外す
 */
function inPage({ op, match, ignore, storybook, mark, index, props }) {
  const settle = () => {
    for (const animation of document.getAnimations()) {
      // 終わりの無いもの（帯の流れなど）は finish() が投げるので、頭で止める。
      if (animation.effect?.getComputedTiming().endTime === Infinity) {
        animation.pause();
        animation.currentTime = 0;
      } else animation.finish();
    }
  };
  if (op === 'settle') return void settle();
  if (op === 'unmark') {
    for (const el of document.querySelectorAll(`[${mark}]`)) el.removeAttribute(mark);
    return null;
  }

  const anchors = new Map();
  for (const attr of match) {
    const seen = new Map();
    for (const el of document.querySelectorAll(`[${CSS.escape(attr)}]`)) {
      if (anchors.has(el)) continue;
      const name = `[${attr}="${el.getAttribute(attr)}"]`;
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      anchors.set(el, n === 1 ? name : `${name}#${n}`);
    }
  }
  const keyOf = (el) => {
    const parts = [];
    for (let e = el; e; e = e.parentElement) {
      if (anchors.has(e)) {
        parts.unshift(anchors.get(e));
        break;
      }
      let i = 1;
      for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === e.localName) i++;
      parts.unshift(i === 1 ? e.localName : `${e.localName}:nth-of-type(${i})`);
    }
    return parts.join(' > ');
  };
  const SKIP = new Set(['script', 'style', 'template', 'link', 'meta']);
  const root = storybook ? document.getElementById('storybook-root') : document.body;
  const inScope = (el) =>
    !SKIP.has(el.localName) && !el.closest('head') && !ignore.some((selector) => el.closest(selector)) &&
    (!storybook || el === document.documentElement || el === document.body || root?.contains(el));

  if (op === 'mark') {
    // `:hover` のルールの、`:hover` が付いた複合セレクタの `:hover` を `:is(*)` に替え、疑似要素を外したものが、当てる先。
    // 消さずに替えるのは、`:is(:hover, :focus-visible)` の中で消すと、セレクタが壊れて当てる先から漏れるため。
    const compounds = new Set();
    const split = (text, at) => {
      const out = [];
      let depth = 0;
      let quote = '';
      let start = 0;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) {
          if (c === '\\') i++;
          else if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (depth === 0 && at.includes(c)) {
          out.push(text.slice(start, i));
          start = i + 1;
        }
      }
      out.push(text.slice(start));
      return out.map((s) => s.trim()).filter(Boolean);
    };
    const visit = (rules, parent) => {
      for (const rule of rules) {
        let selector = parent;
        if (typeof rule.selectorText === 'string') {
          selector = parent
            ? split(rule.selectorText, ',').map((s) => (s.includes('&') ? s.replaceAll('&', `:is(${parent})`) : `:is(${parent}) ${s}`)).join(', ')
            : rule.selectorText;
          for (const complex of split(selector, ',')) {
            for (const compound of split(complex, ' >+~\n\t')) {
              if (!compound.includes(':hover')) continue;
              compounds.add(compound.replaceAll(':hover', ':is(*)').replace(/::?(before|after|marker|placeholder|selection|backdrop)\b/g, ''));
            }
          }
        }
        if (rule.cssRules) visit(rule.cssRules, selector);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        visit(sheet.cssRules, '');
      } catch {
        // 外のオリジンのスタイルシートは読めない。
      }
    }
    const hover = new Set();
    for (const compound of compounds) {
      try {
        for (const el of document.querySelectorAll(compound)) hover.add(el);
      } catch {
        // `:is()` の入れ子などで読めないセレクタは飛ばす。
      }
    }
    const focus = new Set(document.querySelectorAll('a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]'));
    const targets = [];
    for (const el of document.querySelectorAll('*')) {
      if (!inScope(el)) continue;
      const pseudos = [...(hover.has(el) ? ['hover'] : []), ...(focus.has(el) ? ['focus-visible'] : [])];
      if (!pseudos.length) continue;
      el.setAttribute(mark, '');
      targets.push({ key: keyOf(el), pseudos });
    }
    return targets;
  }

  let elements = document.querySelectorAll('*');
  if (index !== undefined) {
    settle();
    const target = document.querySelectorAll(`[${mark}]`)[index];
    elements = [target, ...target.querySelectorAll('*')];
  }
  let names = props ? JSON.parse(props) : null;
  if (!names) {
    const found = new Set();
    const own = getComputedStyle(document.documentElement);
    for (let i = 0; i < own.length; i++) found.add(own.item(i));
    const addCustom = (style) => {
      for (let i = 0; i < style.length; i++) if (style.item(i).startsWith('--')) found.add(style.item(i));
    };
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.style) addCustom(rule.style);
        if (rule.cssRules) walk(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {
        // 外のオリジンのスタイルシートは読めない。
      }
    }
    for (const el of document.querySelectorAll('[style]')) addCustom(el.style);
    names = [...found];
  }
  const rows = [];
  // `url()` は絶対 URL で返る。A と B は別のポートで配るので、自分のオリジンを外さないと、それだけで差に出る。
  const origin = location.origin;
  for (const el of elements) {
    if (!inScope(el)) continue;
    const key = keyOf(el);
    for (const pseudo of ['', '::before', '::after']) {
      const style = getComputedStyle(el, pseudo || null);
      if (pseudo && (style.content === 'none' || style.content === 'normal')) continue;
      rows.push([key + pseudo, names.map((name) => style.getPropertyValue(name).replaceAll(origin, ''))]);
    }
  }
  // プロパティごとにいちばん多い値を1つ送り、要素ごとにはそれと違う値だけを [列, 値, …] で送る。
  const mode = names.map((_, i) => {
    const counts = new Map();
    let best = '';
    let most = 0;
    for (const [, values] of rows) {
      const n = (counts.get(values[i]) ?? 0) + 1;
      counts.set(values[i], n);
      if (n > most) [best, most] = [values[i], n];
    }
    return best;
  });
  const sparse = rows.map(([key, values]) => [key, values.flatMap((value, i) => (value === mode[i] ? [] : [i, value]))]);
  return JSON.stringify({ props: names, mode, rows: sparse });
}

/** `Math.random` を、開くたびに同じ列を返すものにする（再生リストの並び、Skeb の作品）。 */
function seedRandom() {
  let seed = 0x2f6b_1a3d;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 1つの条件で、片方のページを読む ----

/** 読んだ値を、要素 → 値の並び（props と同じ順）に戻す。値は数十万になるので、名前ごとのオブジェクトにはしない。 */
const toTable = ({ props, mode, rows }) => ({
  props,
  rows: new Map(
    rows.map(([key, pairs]) => {
      const values = mode.slice();
      for (let i = 0; i < pairs.length; i += 2) values[pairs[i]] = pairs[i + 1];
      return [key, values];
    }),
  ),
});

/**
 * 通信が止み、終わりのあるアニメーションと移り変わりが終わるまで待つ。
 * 移り変わりは finish() で終わらせない。Playwright 1.63 の WebKit 26.6 では、配信中の畑の添え書きのにじみ（長さ0で遅れのある移り変わり）を
 * finish() すると、始まりの値が残る回がある（RRNNM-74 で確かめた）。networkidle も使わない。WebKit で終わらない回があった。
 */
async function settleDown(page, inflight) {
  // 待ったあとに数える。数えてから待つと、最後に待つあいだに始まった通信を見ずに抜ける。
  for (let quiet = 0, waited = 0; quiet < QUIET_MS; waited += POLL_MS) {
    if (waited > NETWORK_GIVE_UP_MS) throw new Error(`通信が止まない: ${[...inflight].slice(0, 3).map((r) => r.url()).join(' ')}`);
    await page.waitForTimeout(POLL_MS);
    quiet = inflight.size ? 0 : quiet + POLL_MS;
  }
  for (let waited = 0; waited < ANIMATION_GIVE_UP_MS; ) {
    const ms = await page.evaluate(() =>
      Math.max(
        0,
        ...document.getAnimations().map((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return animation.playState === 'running' && timing && timing.endTime !== Infinity ? timing.endTime - (timing.localTime ?? 0) : 0;
        }),
      ),
    );
    if (ms <= 0) return;
    const wait = Math.min(ms + POLL_MS, ANIMATION_GIVE_UP_MS - waited);
    await page.waitForTimeout(wait);
    waited += wait;
  }
}

/** 1つのページを開き、状態ごとに computed style を読む。返すのは 状態 → { base, forced } */
async function readSide(browser, side, path, cond, kind) {
  const context = await browser.newContext({
    viewport: { width: cond.width, height: HEIGHT },
    javaScriptEnabled: cond.js,
    reducedMotion: cond.motion,
    forcedColors: cond.forced,
  });
  try {
    await context.route(
      (url) => /\.woff2?$/.test(url.pathname) || (!args.external && url.origin !== new URL(side.base).origin),
      (route) => route.abort(),
    );
    const page = await context.newPage();
    const inflight = new Set();
    page.on('request', (request) => inflight.add(request));
    for (const event of ['requestfinished', 'requestfailed']) page.on(event, (request) => inflight.delete(request));
    if (cond.js) {
      await page.clock.setFixedTime(FIXED_TIME);
      await page.addInitScript(seedRandom);
    }
    const storybook = kind === 'storybook';
    const response = await page.goto(storybook ? `${side.base}/iframe.html?id=${encodeURIComponent(path)}&viewMode=story` : side.base + path);
    if (response && !response.ok()) throw new Error(`HTTP ${response.status()}`);
    if (storybook) {
      await page.waitForFunction(() => /\bsb-show-(main|errordisplay|nopreview)\b/.test(document.body.className));
      if (await page.evaluate(() => !document.body.classList.contains('sb-show-main'))) throw new Error('story を描けなかった');
    }
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await settleDown(page, inflight);

    const cdp = cond.browser === 'chromium' ? await context.newCDPSession(page) : null;
    if (cdp) {
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
    }
    const opts = { match, ignore, storybook, mark: MARK };
    const out = new Map();
    const record = async (variant) => {
      await page.evaluate(inPage, { ...opts, op: 'settle' });
      const read = JSON.parse(await page.evaluate(inPage, { ...opts, op: 'read' }));
      const props = JSON.stringify(read.props);
      const base = toTable(read);
      const forced = new Map();
      if (cdp) {
        const targets = await page.evaluate(inPage, { ...opts, op: 'mark' });
        const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
        const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: `[${MARK}]` });
        if (nodeIds.length !== targets.length) throw new Error('当てる要素の数が合わない');
        for (const [index, target] of targets.entries()) {
          for (const pseudo of target.pseudos) {
            await cdp.send('CSS.forcePseudoState', { nodeId: nodeIds[index], forcedPseudoClasses: [pseudo] });
            forced.set(`${target.key}:${pseudo}`, toTable(JSON.parse(await page.evaluate(inPage, { ...opts, op: 'read', index, props }))));
            await cdp.send('CSS.forcePseudoState', { nodeId: nodeIds[index], forcedPseudoClasses: [] });
          }
        }
        await page.evaluate(inPage, { ...opts, op: 'unmark' });
      }
      out.set(variant, { base, forced });
    };

    await record('');
    const state = await page.evaluate(() => document.querySelector('[data-field]')?.getAttribute('data-state') ?? null);
    if (state !== null) {
      for (const next of ['day', 'soon', 'live'].filter((s) => s !== state)) {
        await page.evaluate((s) => document.querySelector('[data-field]')?.setAttribute('data-state', s), next);
        await settleDown(page, inflight);
        await record(`畑=${next}`);
      }
      await page.evaluate((s) => document.querySelector('[data-field]')?.setAttribute('data-state', s), state);
      await settleDown(page, inflight);
    }
    if (cond.js && (await page.evaluate(() => document.querySelector('[data-playlists-more]')?.hidden === false))) {
      await page.evaluate(() => {
        document.querySelector('[data-playlists-more]')?.click();
        // ボタンが消えるとフォーカスが7件目へ移る。当て方は両方で同じでも、外しておけば :focus-visible の差を見ずに済む。
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await settleDown(page, inflight);
      await record('再生リスト=広げる');
    }
    return out;
  } finally {
    await context.close();
  }
}

// ---- 比べる ----

const report = { standard: new Map(), custom: new Map(), only: new Map(), errors: [], skipped: [] };

function add(map, key, make) {
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
}

/** 1つのプロパティの差を report に足す。 */
function addDiff(where, key, prop, va, vb, cond) {
  if (prop.startsWith('--')) {
    const entry = add(report.custom, prop, () => ({ elements: new Set(), conds: new Map(), samples: new Map() }));
    entry.elements.add(`${where}\u0000${key}`);
    entry.conds.set(label(cond), cond);
    const sample = `${JSON.stringify(va)} → ${JSON.stringify(vb)}`;
    entry.samples.set(sample, (entry.samples.get(sample) ?? 0) + 1);
  } else {
    add(report.standard, JSON.stringify([where, key, prop, va, vb]), () => []).push(cond);
  }
}

function compareTables(where, a, b, cond) {
  // ふつうは両方で同じ名前が同じ順に並ぶので、並びのまま比べる。違うとき（カスタムプロパティを足したなど）だけ名前で引く。
  const same = a.props.length === b.props.length && a.props.every((p, i) => p === b.props[i]);
  const names = same ? a.props : [...new Set([...a.props, ...b.props])];
  const at = (table) => (same ? null : new Map(table.props.map((p, i) => [p, i])));
  const ia = at(a);
  const ib = at(b);
  for (const key of new Set([...a.rows.keys(), ...b.rows.keys()])) {
    const va = a.rows.get(key);
    const vb = b.rows.get(key);
    if (!va || !vb) {
      add(report.only, JSON.stringify([where, key, va ? 'A' : 'B']), () => []).push(cond);
      continue;
    }
    for (let i = 0; i < names.length; i++) {
      const x = same ? va[i] : (va[ia.get(names[i])] ?? '');
      const y = same ? vb[i] : (vb[ib.get(names[i])] ?? '');
      if (x !== y) addDiff(where, key, names[i], x, y, cond);
    }
  }
}

function compareSides(path, A, B, cond) {
  for (const variant of new Set([...A.keys(), ...B.keys()])) {
    const where = variant ? `${path}（${variant}）` : path;
    const a = A.get(variant);
    const b = B.get(variant);
    if (!a || !b) {
      add(report.only, JSON.stringify([where, '（この状態）', a ? 'A' : 'B']), () => []).push(cond);
      continue;
    }
    compareTables(where, a.base, b.base, cond);
    // 当てる先が片方にしか無いとき（`:hover` のルールを足した・消したなど）は、もう片方は当てていない値と比べる。
    for (const target of new Set([...a.forced.keys(), ...b.forced.keys()])) {
      const fa = a.forced.get(target);
      const fb = b.forced.get(target);
      // 当てた側で消えた疑似要素（`:hover::before { content: none }` など）も、もう片方の値と比べる。
      const keys = new Set([...(fa ?? fb).rows.keys()].flatMap((k) => (/::(before|after)$/.test(k) ? [k] : [k, `${k}::before`, `${k}::after`])));
      const pick = (forced, base) => forced ?? { props: base.props, rows: new Map([...keys].filter((k) => base.rows.has(k)).map((k) => [k, base.rows.get(k)])) };
      compareTables(`${where} ${target}`, pick(fa, a.base), pick(fb, b.base), cond);
    }
  }
}

// ---- 回す ----

const AXES = [
  ['browser', (c) => c.browser],
  ['width', (c) => `${c.width}px`],
  ['motion', (c) => (c.motion === 'reduce' ? '動きを減らす' : '動きそのまま')],
  ['js', (c) => (c.js ? 'JS あり' : 'JS なし')],
  ['forced', (c) => (c.forced === 'active' ? 'forced-colors' : '色そのまま')],
];
const label = (c) => AXES.map(([, f]) => f(c)).join(' ');
/** 条件の一覧を、軸ごとの値の並びにまとめる。 */
const summarize = (conds) => AXES.map(([, f]) => [...new Set(conds.map(f))].join('・')).join(' / ');

const [sideA, sideB] = await Promise.all(positionals.map(serve));
const kind = (await readJson(sideB, 'index.json'))?.entries && (sideB.dir ? existsSync(join(sideB.dir, 'iframe.html')) : true) ? 'storybook' : 'site';
async function listPaths(side) {
  if (kind === 'storybook') {
    const index = await readJson(side, 'index.json');
    // 空の一覧にすると、もう片方の全 story を片方にしか無いものとして出し、終了コード 1 になる。
    if (!index?.entries) {
      console.error(`${side.dir ?? side.base} の index.json に story の一覧が無い`);
      process.exit(2);
    }
    return Object.values(index.entries).filter((e) => e.type === 'story').map((e) => e.id);
  }
  return side.dir ? sitePaths(side.dir) : null;
}
let paths = list(args.paths, '--paths');
if (!paths) {
  const [inA, inB] = await Promise.all([listPaths(sideA), listPaths(sideB)]);
  if (!inA || !inB) usage('URL のサイトは --paths で開くページを渡す');
  for (const [side, mine, other] of [['A', inA, inB], ['B', inB, inA]]) {
    for (const path of mine) if (!other.includes(path)) add(report.only, JSON.stringify([path, '（このページ）', side]), () => []);
  }
  paths = inA.filter((path) => inB.includes(path)).sort();
  if (!paths.length && !report.only.size) usage('比べるページ・story が1つも無い（ビルドの出力のディレクトリを渡しているか確かめる）');
}
if (kind === 'site') for (const path of paths) if (!path.startsWith('/')) usage(`サイトのパスは / で始める（Git Bash では MSYS_NO_PATHCONV=1 を付け、ディレクトリは C:/… の形で渡す）: ${path}`);

const started = Date.now();
let done = 0;
try {
  // ブラウザは1つずつ立て、その条件を回し終えたら閉じる。2つを立てたままにすると、メモリを倍使う。
  for (const name of browserNames) {
    const browser = await BROWSERS[name].launch();
    try {
      const probe = await browser.newContext({ forcedColors: 'active' });
      const forcedWorks = await (await probe.newPage()).evaluate(() => matchMedia('(forced-colors: active)').matches);
      await probe.close();
      if (!forcedWorks) report.skipped.push(`${name} は forced-colors を当てても効かないので、その条件を飛ばした`);

      const queue = [];
      for (const path of paths) {
        for (const width of widths) {
          for (const motion of ['no-preference', 'reduce']) {
            for (const js of kind === 'storybook' ? [true] : [true, false]) {
              for (const forced of forcedWorks ? ['none', 'active'] : ['none']) queue.push({ path, cond: { browser: name, width, motion, js, forced } });
            }
          }
        }
      }
      console.error(`${kind === 'storybook' ? 'Storybook' : 'サイト'}・${name}: ${paths.length} ページ × 条件 = ${queue.length} 通りを比べる`);
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const { path, cond } = job;
          try {
            // 片方が先に失敗しても、もう片方のページを閉じ終えるまで待つ。待たずに次へ進むと、開いたページが --jobs を超えて溜まる。
            const [A, B] = await Promise.allSettled([readSide(browser, sideA, path, cond, kind), readSide(browser, sideB, path, cond, kind)]);
            const failed = [['A', A], ['B', B]].filter(([, result]) => result.status === 'rejected');
            if (failed.length) throw new Error(failed.map(([side, result]) => `${side}: ${result.reason instanceof Error ? result.reason.message.split('\n')[0] : result.reason}`).join(' / '));
            compareSides(path, A.value, B.value, cond);
          } catch (error) {
            report.errors.push(`${path} ${label(cond)}: ${error instanceof Error ? error.message.split('\n')[0] : error}`);
          }
          done++;
          if (done % 10 === 0) console.error(`  ${done} 通り（${Math.round((Date.now() - started) / 1000)} 秒）`);
        }
      };
      await Promise.all(Array.from({ length: jobs }, worker));
    } finally {
      await browser.close();
    }
  }
} finally {
  sideA.close();
  sideB.close();
}

// ---- 出す ----

const out = (line = '') => console.log(line);
out(`A: ${positionals[0]}`);
out(`B: ${positionals[1]}`);
out(`${done} 通りを ${Math.round((Date.now() - started) / 1000)} 秒で比べた`);
for (const line of report.skipped) out(`※ ${line}`);
if (!browserNames.includes('chromium')) out('※ Chromium を外したので、:hover・:focus-visible を当てた状態は比べていない');

out();
out(`標準のプロパティの差: ${report.standard.size} 件`);
for (const [json, conds] of [...report.standard].sort(([x], [y]) => x.localeCompare(y))) {
  const [where, key, prop, va, vb] = JSON.parse(json);
  out(`  ${where}  ${key}`);
  out(`    ${prop}: ${JSON.stringify(va)} → ${JSON.stringify(vb)}（${conds.length} 通り: ${summarize(conds)}）`);
}

out();
out(`片方にしか無い要素・ページ: ${report.only.size} 件`);
for (const [json, conds] of [...report.only].sort(([x], [y]) => x.localeCompare(y))) {
  const [where, key, side] = JSON.parse(json);
  out(`  ${side} だけ  ${where}  ${key}${conds.length ? `（${conds.length} 通り: ${summarize(conds)}）` : ''}`);
}

out();
out(`カスタムプロパティの差: ${report.custom.size} 個`);
for (const [prop, entry] of [...report.custom].sort(([x], [y]) => x.localeCompare(y))) {
  const samples = [...entry.samples].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([s]) => s).join('、');
  out(`  ${prop}: ${entry.elements.size} 要素（${summarize([...entry.conds.values()])}）  ${samples}`);
}

if (report.errors.length) {
  out();
  out(`開けなかったページ: ${report.errors.length} 件`);
  for (const line of report.errors) out(`  ${line}`);
}

process.exitCode = report.errors.length ? 2 : report.standard.size || report.only.size ? 1 : 0;
