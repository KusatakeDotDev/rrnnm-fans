import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { digestDist } from '../../scripts/dist-receipt.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

for (const [name, response, message] of [
  ['HTTP失敗', "new Response('', { status: 503 })", '予定画像の取得失敗: 503'],
  ['プレースホルダー', "new Response('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\" height=\"90\"/>')", '予定画像の寸法が一致しない'],
  ['画像でない応答', "new Response('not an image')", 'unsupported image format'],
  ['通信エラー', "Promise.reject(new Error('fixture network failure'))", 'fixture network failure'],
] as const) {
  test(`本番の実画像検査が ${name} を拒否し、以前の検査記録も消す`, () => {
    const root = mkdtempSync(join(tmpdir(), 'release-image-'));
    roots.push(root);
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist/index.html'), '<img src="https://i.ytimg.com/vi/test/maxresdefault.jpg" width="1280" height="720">');
    const receipt = JSON.stringify({ kind: 'live', digest: digestDist(join(root, 'dist')) });
    writeFileSync(join(root, 'dist.receipt.json'), receipt);
    writeFileSync(join(root, 'dist.verified.json'), receipt);
    const preload = join(root, 'fetch.mjs');
    writeFileSync(preload, `globalThis.fetch = async () => ${response};`);
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, fileURLToPath(new URL('../../scripts/verify-release.mjs', import.meta.url))], {
      cwd: root, encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(existsSync(join(root, 'dist.verified.json'))).toBe(false);
  });
}
