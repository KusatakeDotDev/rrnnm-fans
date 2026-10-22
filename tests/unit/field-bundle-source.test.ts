import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFieldBundle } from '../../src/lib/field-bundle-source';

const hasPrivate = existsSync(new URL('../../src/lib/field-bundle.ts', import.meta.url));

describe('RRNNM-44 — 花の株のバンドルの読み解き方', () => {
  it('読めないものは、重ねていてもいなくても null（株を描かずに一枚絵の花で描く）', () => {
    expect(parseFieldBundle(new ArrayBuffer(0))).toBeNull();
    expect(parseFieldBundle(new Uint8Array(64).buffer)).toBeNull();
  });

  it.skipIf(hasPrivate)('重ねていなければ、どんな入力も null', () => {
    expect(parseFieldBundle(new Uint8Array(1024).fill(0xff).buffer)).toBeNull();
  });
});
