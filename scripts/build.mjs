import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { parseShowUnreleased } from '../src/lib/unreleased.ts';
import { digestDist } from './dist-receipt.mjs';

const scenario = process.argv[2];
if (scenario && scenario !== 'success') throw new Error(`不明なシナリオ: ${scenario}`);
if (process.env.TEST_BUILD_SCENARIO || process.env.TEST_DIST) throw new Error('build の環境にテスト設定が残っている');
const showUnreleased = parseShowUnreleased(process.env.SHOW_UNRELEASED, 'build');
const dir = scenario ? '.test-dist' : 'dist';
if (!scenario) rmSync('dist.verified.json', { force: true });
rmSync(`${dir}.receipt.json`, { force: true });
rmSync(dir, { recursive: true, force: true });
// Astro のテレメトリーは signal の無い fetch で送るので、固定応答の検査で落ちないよう、そのビルドでだけ止める。
const env = { ...process.env, SHOW_UNRELEASED: showUnreleased ? '1' : '0', ...(scenario ? { TEST_BUILD_SCENARIO: scenario, ASTRO_TELEMETRY_DISABLED: '1' } : {}) };
const preload = new URL('../tests/fixtures/build-fetch.mjs', import.meta.url).href;
const args = [...(scenario ? ['--import', preload] : []), 'node_modules/astro/bin/astro.mjs', 'build', '--outDir', dir];
for (const command of [args, ['scripts/prune-unreferenced-assets.mjs', dir]]) {
  const result = spawnSync(process.execPath, command, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
readFileSync(`${dir}/index.html`);
writeFileSync(`${dir}.receipt.json`, JSON.stringify({ kind: scenario ?? 'live', showUnreleased, digest: digestDist(dir) }));
