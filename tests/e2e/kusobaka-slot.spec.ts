import { expect, test, type Page } from '@playwright/test';

import { CHEERS, MISSES, REACTIONS, SOUND_LEVEL, WORD } from '../../src/lib/kusobaka-slot';

/**
 * src/pages/kusobaka-slot.astro。期限（既定は元ネタの日の日本時間の終わり）までは、どの順に押しても4本とも「クソバカ」で止まり、
 * 押すたびに音が鳴り、もう1回回せる（連チャン）。期限を過ぎると目押しになり、日付を延ばすと、またかならずそろう。
 * 鳴らした音は、AudioBufferSourceNode の start・stop を音の名前で記録して見る。どのセリフを選ぶかは
 * tests/unit/kusobaka-slot.test.ts が見るので、ここでは乱数を 0 に留めて、選ぶセリフを決め打ちにする。
 */

const REACTION = REACTIONS[0];
const CHEER = CHEERS[0];
const MISS = MISSES[0];
/** そろうまでのセリフのデコードだけを遅らせ、そろったときのセリフより後に取れるようにする。4本止めてそろうまでより長くする。 */
const SLOW_DECODE_MS = 2_000;

/** 1回そろえるまでに鳴る音。1〜3本めは停止音とセリフ、4本めは停止音・成功音・セリフ。 */
const SOUNDS_PER_ROUND = 2 * (WORD.length - 1) + 3;

const positions = (page: Page) =>
  page.locator('[data-slot-reel] > *').evaluateAll((strips) => strips.map((strip) => Number((strip as HTMLElement).style.getPropertyValue('--position'))));
const centered = (at: number[]) => at.map((position) => WORD[position % WORD.length] ?? '?');
const soundLog = (page: Page) => page.evaluate(() => (window as unknown as { soundLog: string[] }).soundLog);
const started = async (page: Page) => (await soundLog(page)).filter((entry) => entry.startsWith('start '));

/** `slow` の名前の音だけ、デコードを `delay` ミリ秒遅らせる。 */
async function recordSounds(page: Page, slow?: { name: string; delay: number }): Promise<void> {
  await page.addInitScript((slowDecode) => {
    const log: string[] = [];
    (window as unknown as { soundLog: string[] }).soundLog = log;
    Math.random = () => 0;

    // ページは mp3 を取ってデコードしてから鳴らすので、取った中身からデコードした音、鳴らすノードへと名前を引き継ぐ。
    const names = new WeakMap<object, string>();
    const originalFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);
      // ページは、取りに行く URL の # の後ろに音の名前を付ける。response.url からは # の後ろが落ちるので、頼んだ URL から読む。
      const name = /#([\w-]+)$/.exec(String(args[0]))?.[1];
      if (name === undefined) return response;
      const read = response.arrayBuffer.bind(response);
      response.arrayBuffer = async () => {
        const data = await read();
        names.set(data, name);
        return data;
      };
      return response;
    };

    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = async function (this: BaseAudioContext, data: ArrayBuffer) {
      const name = names.get(data);
      const buffer = await decode.call(this, data);
      if (slowDecode && name === slowDecode.name) await new Promise((resolve) => setTimeout(resolve, slowDecode.delay));
      if (name !== undefined) names.set(buffer, name);
      return buffer;
    };

    const gains: GainNode[] = [];
    (window as unknown as { gains: GainNode[] }).gains = gains;
    const createGain = BaseAudioContext.prototype.createGain;
    BaseAudioContext.prototype.createGain = function (this: BaseAudioContext) {
      const gain = createGain.call(this);
      gains.push(gain);
      return gain;
    };

    const nameOf = (node: AudioBufferSourceNode) => (node.buffer ? names.get(node.buffer) : undefined) ?? '?';
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<typeof start>) {
      log.push(`start ${nameOf(this)}`);
      return start.apply(this, args);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (this: AudioBufferSourceNode, ...args: Parameters<typeof stop>) {
      log.push(`stop ${nameOf(this)}`);
      return stop.apply(this, args);
    };
  }, slow);
}

test('クソバカスロット — 期限までは、押すたびに音が鳴り、4本でクソバカがそろい、もう1回回せる', async ({ page }) => {
  await recordSounds(page, { name: REACTION, delay: SLOW_DECODE_MS });
  // 時計は止めずに、日付だけを期限の2時間前に留める。リールは本物の時間で回す。
  await page.clock.setFixedTime(new Date('2026-10-18T22:00:00+09:00'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/kusobaka-slot/');

  const start = page.locator('[data-slot-start]');
  const stops = page.locator('[data-slot-stop]');
  const count = page.locator('[data-slot-count]');

  await expect(page.locator('[data-slot]')).not.toHaveAttribute('data-expired');

  await expect(start).toBeEnabled();
  await start.click();
  const [before] = await positions(page);
  await expect.poll(async () => (await positions(page))[0]).not.toBe(before);

  for (let i = 0; i < WORD.length; i++) await stops.nth(i).click();
  await expect(count).toHaveText('1');
  expect(centered(await positions(page))).toEqual([...WORD]);
  await expect.poll(async () => (await started(page)).length, { timeout: SLOW_DECODE_MS + 5_000 }).toBe(SOUNDS_PER_ROUND);

  await test.step('そろうまでのセリフが後から取れても、頼んだ順に鳴らし、そろったときのセリフを切らない', async () => {
    const voices = (await soundLog(page)).filter((entry) => / (reaction|cheer)-/.test(entry));
    expect(voices.filter((entry) => entry.startsWith('start '))).toEqual([...Array<string>(WORD.length - 1).fill(`start ${REACTION}`), `start ${CHEER}`]);
    expect(voices).not.toContain(`stop ${CHEER}`);
  });

  // ページを開き直さず、動きを減らす設定に切り替えて2回めを回す（E2E の時間を延ばさないため）。
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(start).toHaveText('もう1回');
  await start.click();
  await expect(page.locator('[data-slot-reel] > *').first(), '動きを減らす設定で、回っている帯を伏せていない').toBeHidden();
  for (let i = WORD.length - 1; i >= 0; i--) await stops.nth(i).click();
  await expect(count).toHaveText('2');
  expect(centered(await positions(page))).toEqual([...WORD]);
  await expect.poll(async () => (await started(page)).length).toBe(SOUNDS_PER_ROUND * 2);

  await test.step('はじめは控えめの大きさで鳴らし、消音にすると止め、開き直しても消音のまま、解けば元の大きさに戻る', async () => {
    const mute = page.locator('[data-slot-mute]');
    // 全体の大きさを掛ける GainNode は、最初に押したときに、ほかより先に1つだけ作る。
    const level = () => page.evaluate(() => (window as unknown as { gains: GainNode[] }).gains[0]?.gain.value);
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    expect(await level()).toBeCloseTo(SOUND_LEVEL, 5);
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    expect(await level()).toBe(0);
    await page.reload();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await start.click();
    expect(await level()).toBe(0);
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    expect(await level()).toBeCloseTo(SOUND_LEVEL, 5);
  });
});

test('クソバカスロット — 期限を過ぎると目押しになり、日付を延ばすと、またかならずそろう', async ({ page }) => {
  await recordSounds(page);
  // リールの位置は時刻から決まるので、時計を止めて、押す時刻を決め打ちにする。
  await page.clock.install({ time: new Date('2026-10-19T00:00:00+09:00') });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/kusobaka-slot/');
  await page.clock.pauseAt(new Date('2026-10-19T00:01:00+09:00'));

  const start = page.locator('[data-slot-start]');
  const stops = page.locator('[data-slot-stop]');
  const count = page.locator('[data-slot-count]');
  const slot = page.locator('[data-slot]');

  await expect(slot).toHaveAttribute('data-expired', '');

  await test.step('回し始めた瞬間に押せば、どのリールも回し始めた字で止まり、目押しでもそろう', async () => {
    await start.click();
    for (let i = 0; i < WORD.length; i++) await stops.nth(i).click();
    await page.clock.runFor(100);
    await expect(count).toHaveText('1');
    expect(centered(await positions(page))).toEqual([...WORD]);
  });

  await test.step('半コマ近く回ってから押すと、次の字で止まり、連チャンが 0 に戻って、成功音を鳴らさず、はずれのセリフだけを鳴らす', async () => {
    await expect.poll(async () => (await started(page)).length).toBe(SOUNDS_PER_ROUND);
    await start.click();
    await page.clock.runFor(40);
    for (let i = 0; i < WORD.length; i++) await stops.nth(i).click();
    await page.clock.runFor(500);
    await expect(count).toHaveText('0');
    expect(centered(await positions(page))).toEqual(['カ', 'ク', 'ソ', 'バ']);
    await expect.poll(async () => (await started(page)).slice(SOUNDS_PER_ROUND)).toEqual([...Array<string>(WORD.length).fill('start stop'), `start ${MISS}`]);
  });

  await test.step('日付を延ばすと確定に戻り、そのことを読み上げる', async () => {
    await page.locator('[data-slot-until]').fill('2026-10-25');
    await expect(slot).not.toHaveAttribute('data-expired');
    // 読み上げは、書き換えが止んでから少し待って出す。
    await page.clock.runFor(1_000);
    await expect(page.locator('[data-slot-status]')).toHaveText('確定');
  });

  await test.step('確定に戻ったら、ずれたところで押してもそろう', async () => {
    await start.click();
    await page.clock.runFor(40);
    for (let i = 0; i < WORD.length; i++) await stops.nth(i).click();
    await page.clock.runFor(1_000);
    await expect(count).toHaveText('1');
    expect(centered(await positions(page))).toEqual([...WORD]);
  });
});
