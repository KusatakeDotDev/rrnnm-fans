import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vite-plus/test';

/**
 * RRNNM-107
 *
 * Claude Code は .github/instructions/ を読まず、paths: 付きの rule の中の @import も展開しないので、
 * 同じ範囲の paths: を付けた .claude/rules/ の rule から指す。範囲がずれると、片方にしか届かない。
 */
const root = new URL('../../', import.meta.url);
const read = (relPath: string) => readFileSync(fileURLToPath(new URL(relPath, root)), 'utf8');

// Windows のエディタが CRLF で保存しても読めるように分ける。
const frontmatterLines = (text: string) => (/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '').split(/\r?\n/);
const capture = (lines: string[], pattern: RegExp) =>
  lines.flatMap((line) => {
    const value = pattern.exec(line)?.[1];
    return value ? [value] : [];
  });
const applyTo = (text: string) => capture(frontmatterLines(text), /^applyTo:\s*"([^"]*)"\s*$/).flatMap((v) => v.split(','));
const paths = (text: string) => capture(frontmatterLines(text), /^\s*-\s*"([^"]+)"\s*$/);

const names = readdirSync(fileURLToPath(new URL('.github/instructions/', root)))
  .filter((file) => file.endsWith('.instructions.md'))
  .map((file) => file.slice(0, -'.instructions.md'.length));

describe('.github/instructions/ のパス別の指示は、Claude Code にも同じ範囲で届く', () => {
  for (const name of names) {
    it(`${name}: .claude/rules/${name}.md が、同じ範囲の paths: でその指示を指す`, () => {
      const instructions = read(`.github/instructions/${name}.instructions.md`);
      const rule = read(`.claude/rules/${name}.md`);
      expect(applyTo(instructions).length).toBeGreaterThan(0);
      expect(paths(rule)).toEqual(applyTo(instructions));
      expect(rule).toContain(`.github/instructions/${name}.instructions.md`);
    });
  }
});
