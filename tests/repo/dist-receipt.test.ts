import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { digestDist } from '../../scripts/dist-receipt.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(kind = 'live', extra: Record<string, unknown> = { showUnreleased: false }) {
  const root = mkdtempSync(join(tmpdir(), 'dist-receipt-'));
  roots.push(root);
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/index.html'), '<html>配布成果物</html>');
  writeFileSync(join(root, 'dist.receipt.json'), JSON.stringify({ kind, ...extra, digest: digestDist(join(root, 'dist')) }));
  return root;
}
function check(root: string, env = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', `import { assertDeployable } from ${JSON.stringify(new URL('../../scripts/dist-receipt.mjs', import.meta.url).href)}; assertDeployable();`], {
    cwd: root, env: { ...process.env, ...env }, encoding: 'utf8',
  });
}
test('実データbuild直後の成果物を通す', () => { expect(check(fixture()).status).toBe(0); });
test('fixture由来の成果物は配布させない', () => { expect(check(fixture('success')).status).not.toBe(0); });
test('コピー・書換えで変わった成果物は配布させない', () => {
  const root = fixture();
  writeFileSync(join(root, 'dist/index.html'), '<html>固定データ</html>');
  expect(check(root).status).not.toBe(0);
});
test('余分なファイルも配布成果物の変更として扱う', () => {
  const root = fixture();
  writeFileSync(join(root, 'dist/extra.txt'), 'fixture');
  expect(check(root).status).not.toBe(0);
});
test('build記録がない成果物は配布させない', () => {
  const root = fixture();
  rmSync(join(root, 'dist.receipt.json'));
  expect(check(root).status).not.toBe(0);
});
test('テスト用の環境が残ったら配布させない', () => {
  expect(check(fixture(), { TEST_DIST: '.test-dist' }).status).not.toBe(0);
});
test('実データbuildだけでは本番配布せず、成果物検査を要求する', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/deploy-dist.mjs', import.meta.url)), 'production'], {
    cwd: fixture(), encoding: 'utf8',
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('dist.verified.json');
});

test('alias の無いプレビューコマンドを本番配布として扱わない', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/deploy-dist.mjs', import.meta.url)), 'preview'], {
    cwd: fixture(), encoding: 'utf8',
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('preview <alias>');
});

function deployProduction(root: string) {
  // 照合を外しても、テストから wrangler の配布まで進まないよう、pnpm の無い PATH で動かす
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  return spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/deploy-dist.mjs', import.meta.url)), 'production'], {
    cwd: root, env: { ...env, PATH: root }, encoding: 'utf8',
  });
}
function verified(root: string, override: Record<string, unknown>) {
  const receipt = JSON.parse(readFileSync(join(root, 'dist.receipt.json'), 'utf8'));
  writeFileSync(join(root, 'dist.verified.json'), JSON.stringify({ ...receipt, ...override }));
  return root;
}
test('未公開のものを出したビルドは、本番に配らない', () => {
  const result = deployProduction(fixture('live', { showUnreleased: true }));
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('未公開のもの（src/unreleased/）を出したビルドは、本番に配らない');
});
test('未公開のものを出したかが記録に無いビルドも、本番に配らない', () => {
  const result = deployProduction(fixture('live', {}));
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('未公開のもの（src/unreleased/）を出したビルドは、本番に配らない');
});
test('検査した記録と digest の違う dist は、本番に配らない', () => {
  const result = deployProduction(verified(fixture(), { digest: '0'.repeat(64) }));
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('検査した dist と一致しない');
});
test('実データbuildでない dist を検査した記録では、本番に配らない', () => {
  const result = deployProduction(verified(fixture(), { kind: 'success' }));
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('検査した dist と一致しない');
});
