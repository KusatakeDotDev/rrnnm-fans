import { spawnSync } from 'node:child_process';

function run(args, env = process.env) {
  const result = spawnSync('pnpm', args, { env, stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status === 0;
}
// 未公開のものにも規約テストを掛ける（ADR-0018 の決定）。手元でオフを確かめるときは SHOW_UNRELEASED=0 を渡す。
const buildEnv = { ...process.env, SHOW_UNRELEASED: process.env.SHOW_UNRELEASED ?? '1' };
let passed = true;
for (const scenario of ['success', 'http-error', 'timeout', 'invalid-json', 'no-maxres']) {
  if (!run(['exec', 'node', 'scripts/build.mjs', scenario], buildEnv)) {
    passed = false;
    continue;
  }
  const env = { ...process.env, TEST_DIST: '.test-dist', TEST_BUILD_SCENARIO: scenario };
  if (!run(['test:e2e', '--output', `test-results/${scenario}`, ...(scenario === 'success' ? [] : ['--config', 'playwright.fallback.config.ts'])], env)) passed = false;
}
process.exitCode = passed ? 0 : 1;
