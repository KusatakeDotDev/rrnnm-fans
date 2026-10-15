import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import type { ParseFieldBundle } from '../../src/lib/fieldBundleSource';
import { DIST } from '../helpers/dist';

test('配布物に単独の購入画像や一般モデルを残さない', async () => {
  const dir = path.join(DIST, 'field');
  const shipped = existsSync(dir) ? readdirSync(dir).sort() : [];
  // 素材は非公開のリポジトリから重ねる（RRNNM-44）。Release は重ねて出すので、無ければ止める。
  test.skip(shipped.length === 0 && process.env.REQUIRE_PRIVATE_ASSETS !== '1', '非公開の素材を重ねていないビルド');
  expect(shipped).toEqual(['NOTICE.txt', 'nemophila.bin']);
  // Playwright は import.meta.glob（src/lib/fieldBundleSource.ts）を読まないので、重ねた読み解き方を直に読む。
  const decoder = pathToFileURL(path.resolve('src/lib/fieldBundle.ts')).href;
  const { parseFieldBundle } = (await import(decoder)) as { parseFieldBundle: ParseFieldBundle };
  const bytes = readFileSync(path.join(dir, 'nemophila.bin'));
  expect(parseFieldBundle(new Uint8Array(bytes).buffer)?.mesh.parts).toHaveLength(5);
});
