import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

function run(args, env = process.env) {
  const result = spawnSync('pnpm', args, { env, stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status === 0;
}
// 手元で worktree を並べて回しても、wrangler dev のポートがぶつからないため（RRNNM-65）。
async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}
// on は未公開のものにも規約テストを掛けるため（ADR-0018 の決定）、off はオフでだけ回る成果物の検査を PR でも回すため
// （ADR-0027「PR でもオフのビルドを回す」）。
const BUILDS = {
  on: { showUnreleased: '1', config: [] },
  off: { showUnreleased: '0', config: ['--config', 'playwright.artifact.config.ts'] },
};
// CI はビルドとシャードでジョブを分ける（ADR-0026 の決定）。pnpm は `--` もそのまま渡すので外す。
// Playwright に渡す値は `--shard=1/3` のように `=` でつなぐ。空白で離すと、値がビルドの名前として読まれる。
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const picked = args.filter((arg) => !arg.startsWith('-'));
const playwrightArgs = args.filter((arg) => arg.startsWith('-'));
for (const name of picked) if (!Object.hasOwn(BUILDS, name)) throw new Error(`不明なビルド: ${name}（on か off）`);
let passed = true;
for (const name of picked.length > 0 ? picked : Object.keys(BUILDS)) {
  const { showUnreleased, config } = BUILDS[name];
  if (!run(['exec', 'node', 'scripts/build.mjs', 'success'], { ...process.env, SHOW_UNRELEASED: showUnreleased })) {
    passed = false;
    continue;
  }
  const env = { ...process.env, TEST_DIST: '.test-dist', E2E_PORT: String(await freePort()) };
  if (!run(['test:e2e', '--output', `test-results/${name}`, ...config, ...playwrightArgs], env)) passed = false;
}
process.exitCode = passed ? 0 : 1;
