import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function digestDist(dir) {
  const hash = createHash('sha256');
  function visit(relative) {
    for (const entry of readdirSync(join(dir, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) hash.update(JSON.stringify([name, readFileSync(join(dir, name)).toString('base64')]));
      else throw new Error(`配布成果物に通常のファイル以外がある: ${name}`);
    }
  }
  visit('');
  return hash.digest('hex');
}

export function assertDeployable() {
  if (process.env.TEST_BUILD_SCENARIO || process.env.TEST_DIST) throw new Error('テスト設定では配布できない');
  const receipt = JSON.parse(readFileSync('dist.receipt.json', 'utf8'));
  if (receipt.kind !== 'live' || receipt.digest !== digestDist('dist')) {
    throw new Error('実データ build の成果物と一致しない');
  }
  return receipt;
}
