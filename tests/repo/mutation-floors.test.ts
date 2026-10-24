import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { checkFloors, fileScores } from '../../scripts/check-mutation-floors.mjs';

const report = (files: Record<string, string[]>) => ({
  files: Object.fromEntries(Object.entries(files).map(([path, statuses]) => [path, { mutants: statuses.map((status) => ({ status })) }])),
});

describe('ミューテーションのスコアを、ファイルごとに下限と比べる', () => {
  it('倒した数を、倒した・生き残った・テストが届かなかった数で割る（タイムアウトは倒したと数える）', () => {
    const [score] = fileScores(report({ 'a.ts': ['Killed', 'Timeout', 'Survived', 'NoCoverage'] }));
    expect(score).toEqual({ path: 'a.ts', valid: 4, score: 50 });
  });

  it('無視したミュータントと、コンパイル・実行で落ちたミュータントは数えない', () => {
    const [score] = fileScores(report({ 'a.ts': ['Killed', 'Ignored', 'CompileError', 'RuntimeError'] }));
    expect(score).toEqual({ path: 'a.ts', valid: 1, score: 100 });
  });

  it('テストを消して全部が届かなくなったファイルは、0 として下限を割る', () => {
    const { below } = checkFloors(fileScores(report({ 'a.ts': ['NoCoverage', 'NoCoverage'] })), { defaultFloor: 95, floors: {} });
    expect(below.map((r: { path: string }) => r.path)).toEqual(['a.ts']);
  });

  it('数えるミュータントの無いファイルは比べない', () => {
    const { below } = checkFloors(fileScores(report({ 'a.ts': [], 'b.ts': ['Ignored'] })), { defaultFloor: 95, floors: {} });
    expect(below).toEqual([]);
  });

  it('表にあるファイルはその下限で、無いファイルは既定の下限で比べる', () => {
    const scores = fileScores(report({ 'a.ts': ['Killed', 'Survived'], 'b.ts': ['Killed', 'Survived'] }));
    const { below } = checkFloors(scores, { defaultFloor: 95, floors: { 'a.ts': 50 } });
    expect(below.map((r: { path: string }) => r.path)).toEqual(['b.ts']);
  });

  it('表にあってレポートに無いファイルを知らせる', () => {
    const { unknown } = checkFloors(fileScores(report({ 'a.ts': ['Killed'] })), { defaultFloor: 95, floors: { 'gone.ts': 80 } });
    expect(unknown).toEqual(['gone.ts']);
  });

  it('Windows の区切りで書かれたパスも、表のパスと突き合わせる', () => {
    const [score] = fileScores(report({ 'src\\lib\\a.ts': ['Killed'] }));
    expect(score?.path).toBe('src/lib/a.ts');
  });
});

describe('下限の検査をコマンドで回す', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
  const run = (files: Record<string, string[]>) => {
    const root = mkdtempSync(join(tmpdir(), 'mutation-floors-'));
    roots.push(root);
    const path = join(root, 'mutation.json');
    writeFileSync(path, JSON.stringify(report(files)));
    return spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/check-mutation-floors.mjs', import.meta.url)), path], { encoding: 'utf8' });
  };

  it('どのファイルも下限以上なら 0 で終わる', () => {
    expect(run({ 'a.ts': ['Killed'] }).status).toBe(0);
  });

  it('下限を割ったファイルがあれば 1 で終わり、そのファイルを挙げる', () => {
    const result = run({ 'a.ts': ['Killed'], 'b.ts': ['Survived'] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('b.ts');
  });
});
