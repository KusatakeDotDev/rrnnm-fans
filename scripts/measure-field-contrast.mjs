/**
 * トップの畑の上の文字（キャッチと添え書き）が、描いた畑の上で読めるかを測る。
 *
 * docs/adr/0010-nemophila-pop.md「ヒーロー — 畑はそのまま、上に乗るものを組み直す」。手元では `pnpm field:contrast [URL] [--states day,soon,live]`
 * （全部で10分ほど。夜が9割を占める）。URL の既定は http://localhost:4321/ なので、先に `pnpm dev` などで配っておく。
 * 夜は、妖精の光が字の後ろを通ると基準を割ると分かっている（Issue rurino-nemo-fansite#139）。
 *
 * axe は畑の上の文字を測れず（地がグラデーションとキャンバスなので incomplete に落とす）、
 * tests/unit/palette.test.ts は空・霞・霧の色としか比べない。花に掛かるところと、
 * 文字の後ろに敷くにじみ（NemophilaField.module.css の --field-halo）の効き目は、描いた絵の上で測るしかない。
 *
 * **CI では回さない。** 畑は GPU が無いと描かない（src/components/field-renderer.ts の isSoftwareRenderer）。
 * ウィンドウは出さずに測る。Playwright の既定の headless（headless shell）はソフトウェア描画なので畑を描かないが、
 * `channel: 'chromium'`（新しい headless）は GPU で描く（2026-10-07、Windows で確かめた）。
 * コードの仕様のテストではないので tests/ に置かない。
 *
 * 測り方: 文字を一色で塗ってにじみを外したところを1度撮り、塗った色になった画素を字形とする。
 * 比べる地は、字形とその周り RING_PX の画素（WCAG 1.4.3 の地は字の周りに見えているところ。にじみは字形の
 * 真ん中でいちばん濃く、外へ出るとすぐ薄くなるので、字形の中だけを見ると良く出る）。そのあと文字だけを
 * 透明にして（にじみは残る）後ろを撮り続け、その画素の色を文字色と比べる。文字は動かないので、字形は最初の1枚で決まる。
 * WebGL が無いときの畑（CSS のグラデーション）も、キャンバスを隠して測る。
 * 比と基準は src/lib/contrast.ts のもの（キャッチは大きい字の AA_LARGE、添え書きは AA_NORMAL）。1つでも割れば非0で終わる。
 *
 * **WebGL の畑は、しばらく撮り続けて一番悪い値を取る。** 字の後ろの明るさは時間で変わる。
 * - 花のそよぎ（光り方の周期は 3 秒ほど）。数コマでは取りこぼした — 夜の添え書きを今より薄いにじみで測ったとき、
 *   3コマでは 4.97、12コマでは 3.85 のコマがあった（2026-10-07）
 * - 妖精の光（field-renderer.ts の wispAt）。地平線のすぐ上を、奥行きの周期 48 秒ほどで行き来する。
 *   昼と配信前の光は白に近いので、本文色（濃紺）の比を上げる側にしか効かない。夜の光（--c-field-live-mote）は
 *   白い文字とほぼ同じ明るさなので、夜は奥行きの1周ぶん撮る。軌道は周期のそろわない sin の和なので、
 *   1周撮っても、すべての位置を通るわけではない
 * 撮る長さは畑の時計で数える。畑の時計は1コマで 0.05 秒（src/lib/field.ts の FIELD_MAX_STEP_S）までしか進まないので、
 * 描く速さが 20fps を下回ると実際の時刻より遅れる。ページの中で同じ数え方の時計を回し、それが進んだ分だけ撮る。
 *
 * **途中で止めたとき。** 起動した Chromium は、このスクリプトのプロセスが終われば、強制終了でも一緒に閉じる
 * （Windows で確かめた）。残るのは、Windows で `pnpm field:contrast` のほうを止めて、このスクリプトの node だけが
 * 残ったとき（開発サーバーの astro と同じ形）。残っている間は Chromium が開発サーバーのページを開いたままなので、
 * 開発サーバーも、使われていないときに 10 分で止まる決まり（DEV_IDLE_MINUTES）では止まらない。
 * node を止めれば Chromium も閉じる。PowerShell の
 *   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'measure-field-contrast' } | Select-Object ProcessId, CreationDate
 * で探し、ほかの worktree やセッションで測っている途中のものでないことを始めた時刻で確かめてから、
 * `Stop-Process -Id <pid>` で止める（コマンドラインは相対パスなので、worktree では絞れない）。
 */
import { parseArgs } from 'node:util';

import { chromium } from 'playwright';

import { AA_LARGE, AA_NORMAL, contrastRatio, relativeLuminance } from '../src/lib/contrast.ts';
import { FIELD_MAX_STEP_S, parseCssRgb } from '../src/lib/field.ts';

const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { states: { type: 'string' } } });
const URL_TO_MEASURE = positionals[0] ?? 'http://localhost:4321/';

/** ビューポートの大きさ。広い画面・背の低い画面・タブレット・狭い画面。 */
const SIZES = [
  [1920, 1080],
  [1440, 900],
  [1366, 768],
  [1280, 800],
  [1280, 640],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [390, 640],
  [360, 640],
];

/** 状態ごとに、WebGL の畑を撮り続ける長さ（畑の時計の秒）。夜は妖精の光の奥行きの1周（上の注）。 */
const SAMPLE_S = { day: 4, soon: 4, live: 50 };
/** 測る状態。`--states` で絞れる。 */
const STATES = args.states?.split(',') ?? Object.keys(SAMPLE_S);
for (const state of STATES) {
  if (!Object.hasOwn(SAMPLE_S, state)) throw new Error(`--states は ${Object.keys(SAMPLE_S).join('・')} から選ぶ: ${state}`);
}
/** 畑の時計がこの倍の実時間を掛けても進みきらなければ、撮るのをやめて「足りない」と出す。 */
const SAMPLE_GIVE_UP = 4;
/**
 * 状態を変えてから測るまで。WebGL の畑の色は畑の時計で移るので、畑の時計で 3 秒待つ（実時間はそれ以上たつので、
 * 実時間で移る空の色 1.2 秒も移り終わる）。CSS の畑は空の色だけなので、実時間で待つ。
 */
const STATE_SETTLE_S = 3;
const STATE_SETTLE_CSS_MS = 1500;
/** コマの間。 */
const FRAME_GAP_MS = 100;
/** 字形の周りの、地として比べる幅。 */
const RING_PX = 2;

const TARGETS = [
  { name: 'キャッチ', selector: '[data-field] h1', need: AA_LARGE },
  { name: '添え書き', selector: '[data-field] h1 ~ p', need: AA_NORMAL },
];

const TEXT = '[data-field] h1, [data-field] h1 *, [data-field] h1 ~ p';
/**
 * 測る間ずっと、文字の登場の演出と移り変わりを止めておく。下の2つのスタイルを足し外しするたびに止めたり
 * 戻したりすると、外したときに演出が最初からかかり直し、要素の箱が演出の分（上へ 0.5rem）ずれる。
 */
const STILL_TEXT = `${TEXT} { animation: none !important; transition: none !important; }`;
/** 一色で塗る（にじみを外す）・文字を透明にする（にじみは残る）。 */
const MASK_TEXT = `${TEXT} { color: #ff00ff !important; text-shadow: none !important; }`;
const HIDE_TEXT = `${TEXT} { color: transparent !important; }`;
/**
 * CSS の畑を測るときは、キャンバスと前回の絵を隠す。WebGL の畑は描き続ける（mountField が見ているのは root の
 * 見え方なので止まらない）が、隠れているので値には響かない。ビューポートごとに GPU を余計に回すだけなので、止めはしない。
 */
const NO_WEBGL = '[data-field] canvas, [data-field] [data-field-snapshot] { display: none !important; }';

/**
 * 相対輝度をチャンネルごとの表にする（相対輝度はチャンネルの和なので、表を足せば元に戻る）。
 * 計算用のページでは src/lib/contrast.ts を読めないので、表にして渡す。
 */
const LUMINANCE = {
  r: Array.from({ length: 256 }, (_, c) => relativeLuminance({ r: c, g: 0, b: 0 })),
  g: Array.from({ length: 256 }, (_, c) => relativeLuminance({ r: 0, g: c, b: 0 })),
  b: Array.from({ length: 256 }, (_, c) => relativeLuminance({ r: 0, g: 0, b: c })),
};

const toHex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

const browser = await chromium.launch({ headless: true, channel: 'chromium' });
try {
  const page = await browser.newPage();
  const calc = await browser.newPage();
  for (const p of [page, calc]) p.on('crash', () => console.error('ブラウザのページが落ちた'));
  const rows = [];
  console.log('畑     画面サイズ  状態   文字      最低の比  基準  コマ数  畑の秒   fps');

  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.goto(URL_TO_MEASURE);
    try {
      await page.waitForSelector('[data-field][data-gl="on"]', { timeout: 15_000 });
    } catch {
      throw new Error('畑が WebGL で描けなかった。GPU のある端末で回す');
    }
    await page.addStyleTag({ content: STILL_TEXT });
    await page.evaluate(startFieldClock, FIELD_MAX_STEP_S);

    for (const render of ['webgl', 'css']) {
      if (render === 'css') {
        await page.addStyleTag({ content: NO_WEBGL });
        await page.evaluate(() => document.querySelector('[data-field]')?.removeAttribute('data-gl'));
      }
      for (const state of STATES) {
        await page.evaluate((s) => document.querySelector('[data-field]')?.setAttribute('data-state', s), state);
        let settled = true;
        if (render === 'webgl') settled = await waitFieldSeconds(page, STATE_SETTLE_S);
        else await page.waitForTimeout(STATE_SETTLE_CSS_MS);
        const seconds = render === 'webgl' ? SAMPLE_S[state] : 0;
        const result = await sample(page, calc, seconds);
        // 待ちか撮る間のどちらかで、畑の時計が決めた長さまで進まなかった。色が移る途中を測ったか、撮り足りない。
        const short = !settled || result.fieldSeconds < seconds;
        // 途中で止まっても、そこまでの値が残るよう、測るたびに出す。
        TARGETS.forEach((target, i) => {
          const row = { render, size: `${width}×${height}`, state, ...target, ratio: result.ratios[i], short };
          rows.push(row);
          const marks = [row.ratio < row.need ? '← 割れている' : '', short ? '← 畑の時計が足りない' : ''].join(' ').trim();
          console.log(
            [
              render.padEnd(5),
              row.size.padEnd(10),
              state.padEnd(5),
              target.name,
              row.ratio.toFixed(2).padStart(7),
              String(target.need).padEnd(4),
              String(result.frames).padStart(6),
              result.fieldSeconds.toFixed(1).padStart(6),
              result.fps.toFixed(0).padStart(5),
              marks,
            ].join('  '),
          );
        });
      }
    }
  }

  console.log('');
  for (const target of TARGETS) {
    const mine = rows.filter((r) => r.name === target.name);
    const low = mine.reduce((a, b) => (b.ratio < a.ratio ? b : a));
    console.log(`${target.name}の最低: ${low.ratio.toFixed(2)}（${low.render} ${low.size} ${low.state}。基準 ${target.need}）`);
  }

  const failed = rows.filter((r) => r.ratio < r.need);
  const short = rows.filter((r) => r.short);
  if (failed.length > 0) console.error(`\n基準を割った組が ${failed.length} 個ある`);
  if (short.length > 0) console.error(`\n畑の時計が決めた長さまで進まなかった組が ${short.length / TARGETS.length} 個ある`);
  if (failed.length > 0 || short.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}

/**
 * ページの中で、畑と同じ数え方の時計（1コマで FIELD_MAX_STEP_S 秒まで）を回す。
 * 描いたコマ数と実際の時刻も持ち、fps は実際の時刻で割って出す（畑の秒で割ると、20fps を下回っても 20 と出る）。
 */
function startFieldClock(maxStep) {
  const clock = { seconds: 0, frames: 0, ms: performance.now() };
  window.fieldClock = clock;
  let last = clock.ms;
  const tick = (now) => {
    clock.seconds += Math.min(maxStep, (now - last) / 1000);
    clock.frames++;
    clock.ms = now;
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** 畑の時計が `seconds` 秒進むまで待つ。SAMPLE_GIVE_UP 倍の実時間で諦め、そのときは false を返す。 */
async function waitFieldSeconds(page, seconds) {
  const start = await page.evaluate(() => window.fieldClock.seconds);
  const giveUp = Date.now() + seconds * 1000 * SAMPLE_GIVE_UP;
  for (;;) {
    if ((await page.evaluate(() => window.fieldClock.seconds)) - start >= seconds) return true;
    if (Date.now() >= giveUp) return false;
    await page.waitForTimeout(100);
  }
}

/**
 * 今の畑の上で、TARGETS の字形とその周りの画素の比の最低値を返す（TARGETS と同じ順）。
 * 畑の時計で `seconds` 秒ぶん後ろを撮り続け、コマをまたいだ最低を取る。0 なら1コマだけ。
 * 撮るのは、文字の要素の箱をまとめた範囲だけ（画面からはみ出した分は切る）。
 */
async function sample(page, calc, seconds) {
  const boxes = await page.evaluate(
    (selectors) =>
      selectors.map((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, color: getComputedStyle(el).color };
      }),
    TARGETS.map((t) => t.selector),
  );
  boxes.forEach((box, i) => {
    if (!box) throw new Error(`${TARGETS[i].selector} が見つからない`);
  });
  const viewport = page.viewportSize();
  const x = Math.floor(Math.max(0, Math.min(...boxes.map((b) => b.left)) - RING_PX));
  const y = Math.floor(Math.max(0, Math.min(...boxes.map((b) => b.top)) - RING_PX));
  const clip = {
    x,
    y,
    width: Math.ceil(Math.min(viewport.width, Math.max(...boxes.map((b) => b.right)) + RING_PX)) - x,
    height: Math.ceil(Math.min(viewport.height, Math.max(...boxes.map((b) => b.bottom)) + RING_PX)) - y,
  };
  const texts = boxes.map((b, i) => {
    const rgb = parseCssRgb(b.color);
    if (!rgb) throw new Error(`${TARGETS[i].selector} の文字色を読めなかった: ${b.color}`);
    return rgb.map((c) => Math.round(c * 255));
  });

  const style = await page.addStyleTag({ content: MASK_TEXT });
  const glyphs = (await page.screenshot({ clip })).toString('base64');
  await style.evaluate((el, css) => (el.textContent = css), HIDE_TEXT);
  try {
    const counts = await calc.evaluate(prepareGlyphs, {
      glyphs,
      ring: RING_PX,
      luminance: LUMINANCE,
      targets: boxes.map((b, i) => ({
        left: b.left - x,
        top: b.top - y,
        right: b.right - x,
        bottom: b.bottom - y,
        text: texts[i],
      })),
    });
    counts.forEach((count, i) => {
      // 字形が1画素も取れなければ、測れていない。通したことにしない。
      if (count === 0) throw new Error(`${TARGETS[i].selector} の字形を撮れなかった`);
    });

    const ratios = TARGETS.map(() => Infinity);
    let frames = 0;
    const start = await page.evaluate(() => ({ ...window.fieldClock }));
    const giveUp = Date.now() + seconds * 1000 * SAMPLE_GIVE_UP;
    let now = start;
    do {
      if (frames > 0) await page.waitForTimeout(FRAME_GAP_MS);
      const behind = (await page.screenshot({ clip })).toString('base64');
      const worst = await calc.evaluate(worstOnFrame, behind);
      // 一番悪い画素は計算用のページが選び、比は src/lib/contrast.ts で出す。
      worst.forEach((rgb, i) => {
        ratios[i] = Math.min(ratios[i], contrastRatio(toHex(texts[i]), toHex(rgb)));
      });
      frames++;
      now = await page.evaluate(() => ({ ...window.fieldClock }));
    } while (now.seconds - start.seconds < seconds && Date.now() < giveUp);
    const fieldSeconds = now.seconds - start.seconds;
    const fps = seconds > 0 ? (now.frames - start.frames) / Math.max((now.ms - start.ms) / 1000, 1e-3) : 0;
    return { ratios, frames, fieldSeconds, fps };
  } finally {
    await style.evaluate((el) => el.remove());
  }
}

/*
 * ここから下の2つは、計算用のページ（calc）の中で走る。撮った PNG を canvas で画素に戻す。
 * 地として比べる画素の位置と文字の明るさは、1つめで window に置き、2つめがコマごとに使う。
 */

async function prepareGlyphs({ glyphs, ring, luminance, targets }) {
  // canvas は1枚を使い回す。画像は data: URL の <img> ではなく ImageBitmap で開き、描いたらすぐ放す —
  // data: URL はコマごとに違うので、ブラウザがそれぞれを別の画像として持ち続け、夜の数百コマでメモリが増えうる。
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
  };
  const lum = (r, g, b) => luminance.r[r] + luminance.g[g] + luminance.b[b];

  const { data, width, height } = await pixels(glyphs);
  // 塗った色（#ff00ff）にほぼなった画素だけが字形。縁の混ざった画素は字形に数えず、周りの側で測る。
  const glyph = new Uint8Array(width * height);
  for (let p = 0; p < glyph.length; p++) {
    const i = p * 4;
    glyph[p] = data[i] > 200 && data[i + 1] < 70 && data[i + 2] > 200 ? 1 : 0;
  }
  window.measure = {
    pixels,
    lum,
    targets: targets.map((t) => {
      const at = [];
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          // 要素の箱の中の字形から ring 画素以内（字形そのものも含む）を、地として比べる。
          let near = false;
          for (let dy = -ring; dy <= ring && !near; dy++) {
            for (let dx = -ring; dx <= ring && !near; dx++) {
              const qx = px + dx;
              const qy = py + dy;
              if (qx < t.left || qx >= t.right || qy < t.top || qy >= t.bottom) continue;
              if (qx >= 0 && qx < width && qy >= 0 && qy < height && glyph[qy * width + qx]) near = true;
            }
          }
          if (near) at.push((py * width + px) * 4);
        }
      }
      return { text: lum(...t.text), at };
    }),
  };
  return window.measure.targets.map((t) => t.at.length);
}

async function worstOnFrame(behind) {
  const { pixels, lum, targets } = window.measure;
  const { data } = await pixels(behind);
  // 文字との比がいちばん小さい画素（明るさが文字にいちばん近い画素）の色を返す。
  return targets.map(({ text, at }) => {
    let worst = null;
    let worstGap = Infinity;
    for (const i of at) {
      const bg = lum(data[i], data[i + 1], data[i + 2]);
      const gap = Math.abs(Math.log((bg + 0.05) / (text + 0.05)));
      if (gap < worstGap) {
        worstGap = gap;
        worst = [data[i], data[i + 1], data[i + 2]];
      }
    }
    return worst;
  });
}
