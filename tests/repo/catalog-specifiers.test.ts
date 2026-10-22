import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * rurino-nemo-fansite#227
 *
 * catalogMode: strict は、package.json を手で直したときや CI では止まらないので、ここで止める
 * （ADR-0017「`catalog:` で指すことを守らせる」）。
 */
const read = (relPath: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relPath}`, import.meta.url)), 'utf8');

// Windows のエディタが CRLF で保存しても読めるように分ける。
const splitLines = (text: string) => text.split(/\r?\n/);
const workspaceLines = splitLines(read('pnpm-workspace.yaml'));

function packageDirs(lines: string[]): string[] {
  const start = lines.indexOf('packages:');
  if (start < 0) return [];
  const block = lines.slice(start + 1);
  // YAML では列を0桁めにも書けるので、`- ` の行ではブロックを終えない。
  const end = block.findIndex((line) => /^[^-#\s]/.test(line));
  return (end < 0 ? block : block.slice(0, end)).flatMap((line) => {
    const m = /^\s*- ['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/.exec(line);
    return m ? [m[1]] : [];
  });
}
// 一覧のキーと比べるので、`./packages/sub` や末尾の `/` も同じパスにそろえる。
const manifestPath = (dir: string) => posix.join(dir, 'package.json');
const manifests = packageDirs(workspaceLines).map(manifestPath);

const LIST_HEADING = '# catalog に入れず、package.json に直接書くもの';
const LIST_ENTRY = /^# - (\S*package\.json) の (\S+?): /;
const headingIndex = workspaceLines.findIndex((line) => line.startsWith(LIST_HEADING));
function listLinesBelowHeading(): string[] {
  if (headingIndex < 0) return [];
  const after = workspaceLines.slice(headingIndex + 1);
  const end = after.findIndex((line) => !line.startsWith('# - '));
  return end < 0 ? after : after.slice(0, end);
}
const listLines = listLinesBelowHeading();
const direct = new Set(
  listLines.flatMap((line) => {
    const m = LIST_ENTRY.exec(line);
    return m ? [`${m[1]} ${m[2]}`] : [];
  }),
);

const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

const specCache = new Map<string, [name: string, spec: string][]>();
function specifiers(path: string): [name: string, spec: string][] {
  let specs = specCache.get(path);
  if (!specs) {
    const manifest = JSON.parse(read(path)) as Partial<Record<(typeof FIELDS)[number], Record<string, string>>>;
    specs = FIELDS.flatMap((field) => Object.entries(manifest[field] ?? {}));
    specCache.set(path, specs);
  }
  return specs;
}

// workspace: はワークスペースどうしの依存で、catalog には入れられない。
const followsCatalog = (spec: string) => spec.startsWith('catalog:') || spec.startsWith('workspace:');

describe('ADR-0017 — package.json の依存は catalog: で指す', () => {
  it('pnpm-workspace.yaml からワークスペースと直接書く一覧を読める', () => {
    // 読めないと、下の検査が見当違いの理由で落ちるか、ワークスペースを見ずに通る。理由を分けて出す。
    expect(manifests).toContain('package.json');
    expect(headingIndex, `pnpm-workspace.yaml に「${LIST_HEADING}」の見出しを置く`).toBeGreaterThanOrEqual(0);
    expect(
      listLines.filter((line) => !LIST_ENTRY.test(line)),
      '一覧の行は `# - <package.json のパス> の <名前>: <理由>` の形で書く',
    ).toEqual([]);
  });

  it.each(manifests)('%s の依存は、直接書くと決めたもの以外 catalog: で指す', (path) => {
    const offenders = specifiers(path)
      .filter(([name, spec]) => !followsCatalog(spec) && !direct.has(`${path} ${name}`))
      .map(([name, spec]) => `${name}: ${spec}`);
    expect(
      offenders,
      'バージョンを pnpm-workspace.yaml の catalog に書いて catalog: で指すか、直接書く理由を catalog の上の一覧に書く',
    ).toEqual([]);
  });

  it('一覧のパスは、ワークスペースの package.json', () => {
    const unknown = [...direct].map((entry) => entry.split(' ')[0]).filter((path) => !manifests.includes(path));
    expect(unknown, '一覧のパスを、pnpm-workspace.yaml の packages: にあるワークスペースの package.json にする').toEqual(
      [],
    );
  });

  it('直接書くと決めたものは、その package.json に catalog: 以外で書いてある', () => {
    // catalog に移したのに一覧の行が残ると、次に範囲で書き戻したときに止まらない。
    const stale = [...direct].filter((entry) => {
      const [path, name] = entry.split(' ');
      if (!manifests.includes(path)) return false;
      const spec = specifiers(path).find(([n]) => n === name)?.[1];
      return spec === undefined || followsCatalog(spec);
    });
    expect(stale, 'catalog の上の一覧から、もう直接書いていないものの行を消す').toEqual([]);
  });
});

describe('pnpm-workspace.yaml の packages: の読み方', () => {
  it.each([
    ['コメントの行', ['packages:', '  - .', '  # サブパッケージ', '  - packages/sub']],
    ['行の終わりのコメント', ['packages:', '  - .', '  - packages/sub # サブパッケージ']],
    ['./ と末尾の /', ['packages:', "  - './'", '  - ./packages/sub/']],
    ['0桁めの列', ['packages:', '- .', '- packages/sub']],
  ])('%s があっても、どのワークスペースも同じパスで拾う', (_, lines) => {
    expect(packageDirs([...lines, 'catalog:']).map(manifestPath)).toEqual(['package.json', 'packages/sub/package.json']);
  });

  it('CRLF の行も読む', () => {
    const text = ['packages:', '  - .', '  - packages/sub', 'catalog:'].join('\r\n');
    expect(packageDirs(splitLines(text)).map(manifestPath)).toEqual(['package.json', 'packages/sub/package.json']);
  });
});
