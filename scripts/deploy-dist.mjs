import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { assertDeployable } from './dist-receipt.mjs';

const [mode, alias, ...extra] = process.argv.slice(2);
if (extra.length || !['production', 'preview'].includes(mode)
  || (mode === 'production' && alias)
  || (mode === 'preview' && !/^[a-z0-9][a-z0-9-]*$/.test(alias ?? ''))) {
  throw new Error('配布先を production または preview <alias> で指定する');
}
const receipt = assertDeployable();
if (mode === 'production') {
  if (receipt.showUnreleased !== false) throw new Error('未公開のもの（src/unreleased/）を出したビルドは、本番に配らない');
  const verified = JSON.parse(readFileSync('dist.verified.json', 'utf8'));
  if (verified.kind !== 'live' || verified.digest !== receipt.digest) throw new Error('検査した dist と一致しない');
}
const args = mode === 'preview' ? ['versions', 'upload', '--preview-alias', alias] : ['deploy'];
const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
