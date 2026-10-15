import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * docs/README.md「ADR の書き方」— コード・テスト・docs から ADR を指すときは、節の名前で指す
 *
 * 追記を指す参照は、追記を畳むと行き先を失う。docs/ の中は ADR を触るときに直す決まりなので、追記のテストでは見ない（rurino-nemo-fansite#197）。
 * 節の名前は、見出しの名前を変えたときに指す先を失っても気づけるよう、見出しと照らし合わせる（rurino-nemo-fansite#226）。
 */
const here = fileURLToPath(new URL('../../', import.meta.url));
/** git は、チェックアウトの持ち主と実行ユーザーが違うと止まる（dubious ownership）。CI はコンテナの root で動く。 */
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'safe.directory=*', '-C', cwd, ...args], { encoding: 'utf8' });

type TrackedText = { path: string; text: string };
let tracked: TrackedText[] | undefined;
/** Stryker はテストを .gitignore された .stryker-tmp/ の中にコピーして回すので、リポジトリのルートで ls-files する。 */
const trackedTexts = (): TrackedText[] => {
  if (tracked) return tracked;
  const root = `${git(here, 'rev-parse', '--show-toplevel').trim()}/`;
  tracked = git(root, 'ls-files', '-z')
    .split('\0')
    .flatMap((path) => {
      // 作業ツリーで消した・名前を変えたまま stage していないファイルも ls-files に出る。
      if (!path || !existsSync(`${root}${path}`)) return [];
      const buf = readFileSync(`${root}${path}`);
      if (buf.includes(0)) return [];
      return [{ path, text: buf.toString('utf8') }];
    });
  return tracked;
};

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

const ADR_REF = /ADR-\d{4}|adr\/\d{4}/g;
/** ADR の参照の前後 100 文字に「追記」があれば、追記を指しているとみなす。日付の無い「ADR-xxxx の追記」も行き先を失うので拾う。 */
const WINDOW = 100;

const appendixRefs = (path: string, text: string): string[] =>
  [...text.matchAll(ADR_REF)]
    .filter((m) => text.slice(Math.max(0, m.index - WINDOW), m.index + m[0].length + WINDOW).includes('追記'))
    .map((m) => `${path}:${lineOf(text, m.index)}`);

/** 空白の有無は比べない。折り返した行の行末の空白は、エディタやフォーマッタが消すため。 */
const squash = (name: string) => name.replace(/\s+/g, '');

/** 自分の「n. 」と、外側の「## n.」の番号。§n はどちらで指してもよい。 */
type Section = { name: string; numbers: number[] };

/** 見出しの「n. 」は節の番号で名前ではない。 */
const sections = (markdown: string): Section[] => {
  const found: Section[] = [];
  let fence: string | undefined;
  let number: number | undefined;
  for (const line of markdown.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    // バッククォートのフェンスは、info string にバッククォートがあるとフェンスではなくインラインコードになる（CommonMark）。
    if (marker && fence === undefined && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      fence = marker[1];
      continue;
    }
    const closes =
      fence !== undefined && marker?.[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim();
    if (closes) {
      fence = undefined;
      continue;
    }
    const heading = fence === undefined ? /^(#{2,6})\s+(?:(\d+)\.\s+)?(.+?)\s*$/.exec(line) : null;
    if (!heading) continue;
    const own = heading[2] ? Number(heading[2]) : undefined;
    if (heading[1] === '##') number = own;
    const numbers = [own, number].filter((n) => n !== undefined);
    const name = heading[3];
    found.push({ name: squash(name), numbers });
    if (name.includes(' — ')) found.push({ name: squash(name.slice(0, name.indexOf(' — '))), numbers });
  }
  return found;
};

type Adr = { file: string; sections: Section[] };

/**
 * 後ろに続く「の「…」」は節の中の文なので見ない。
 * docs/DESIGN.md・CONCEPT.md の「§n「…」」は本文の文を引くことが多く、見出しと区別できないので見ない（rurino-nemo-fansite#226）。
 */
const SECTION_REF =
  /(?:(?:ADR-|adr\/)(?<num>\d{4})(?<slug>-[\w.-]+?\.md)?|\]\((?<linkPath>[^)\s]*\/)?adr\/(?<linkNum>\d{4})(?<linkSlug>-[\w.-]+?\.md)(?:#[^)\s]*)?\)|\]\((?:\.\/)?(?<localNum>\d{4})(?<localSlug>-[\w.-]+?\.md)(?:#[^)\s]*)?\))(?: ?§(?<section>\d+)[\d.]*)?「/g;
/** コメントや引用の中で折り返した参照があるので、次の行の頭のコメント・引用の記号を除いてつなぐ。 */
const CONTINUATION = /\n[ \t]*(?:\/\/|#|\*|>)?[ \t]*/y;
const MAX_NAME = 200;

/** 見出しに「」を含むもの（ADR-0010 の配色の節など）があるので、入れ子を数える。 */
const sectionName = (text: string, start: number): string | null => {
  let name = '';
  let depth = 1;
  let i = start;
  while (i < text.length && name.length <= MAX_NAME) {
    const c = text[i];
    if (c === '\n') {
      CONTINUATION.lastIndex = i;
      CONTINUATION.exec(text);
      i = CONTINUATION.lastIndex;
      continue;
    }
    if (c === '「') depth++;
    if (c === '」' && --depth === 0) return name;
    name += c;
    i++;
  }
  return null;
};

const brokenSectionRefs = (path: string, text: string, adrs: ReadonlyMap<string, Adr>): string[] =>
  [...text.matchAll(SECTION_REF)].flatMap((m) => {
    const g = m.groups!;
    // `](./0001-….md)` が ADR を指すのは、docs/adr/ の中から張ったときだけ。
    if (g.localNum !== undefined && !path.startsWith('docs/adr/')) return [];
    // パーマリンクと外のサイトへのリンクは、今の ADR ではなく、そのときの形やほかのリポジトリを指す。
    if (g.linkPath !== undefined && /^https?:\/\/|blob\/[0-9a-f]+\//.test(g.linkPath)) return [];
    const number = g.num ?? g.linkNum ?? g.localNum;
    const slug = g.slug ?? g.linkSlug ?? g.localSlug;
    const name = sectionName(text, m.index + m[0].length);
    const adr = adrs.get(number);
    const ok =
      name !== null &&
      adr !== undefined &&
      (slug === undefined || adr.file === `${number}${slug}`) &&
      adr.sections.some(
        (s) => s.name === squash(name) && (g.section === undefined || s.numbers.includes(Number(g.section))),
      );
    return ok ? [] : [`${path}:${lineOf(text, m.index)} ${m[0]}${name ?? '（閉じていない）'}」`];
  });

// docs/ は非公開のリポジトリ（rrnnm-fans-docs）を手元に置いたときだけあり、git には入っていない（RRNNM-45）。
const docsDir = fileURLToPath(new URL('../../docs/', import.meta.url));
const docsTexts = (): TrackedText[] =>
  readdirSync(docsDir, { recursive: true, encoding: 'utf8' })
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.md') && !file.startsWith('.git/'))
    .map((file) => ({ path: `docs/${file}`, text: readFileSync(`${docsDir}${file}`, 'utf8') }));

describe('docs/README.md「ADR の書き方」 — ADR を節の名前で指す', () => {
  // git は import の時点では呼ばない。git が無いところでは、ファイルごとではなくこのテストの失敗として出す。
  it('docs/ の外のテキストファイルは、ADR を追記で指していない', () => {
    const files = trackedTexts().filter(({ path }) => !path.startsWith('docs/'));
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap(({ path, text }) => appendixRefs(path, text))).toEqual([]);
  });

  it.skipIf(!existsSync(docsDir))('ADR の節の名前は、その ADR の見出しにある', () => {
    const files = [...trackedTexts().filter(({ path }) => !path.startsWith('docs/')), ...docsTexts()];
    const adrs = new Map<string, Adr>();
    const duplicates: string[] = [];
    for (const { path, text } of files) {
      const adr = /^docs\/adr\/((\d{4})-[^/]+\.md)$/.exec(path);
      if (!adr) continue;
      // 並行する PR が同じ番号で ADR を足すと、どちらの節を指しているか決まらないため。
      const seen = adrs.get(adr[2]);
      if (seen) duplicates.push(`${seen.file} と ${adr[1]}`);
      adrs.set(adr[2], { file: adr[1], sections: sections(text) });
    }
    expect(duplicates, 'ADR の番号が重なっている').toEqual([]);
    expect(adrs.size).toBeGreaterThan(0);
    expect(files.flatMap(({ path, text }) => brokenSectionRefs(path, text, adrs))).toEqual([]);
  });

  it('§n は見出しの番号か外側の ## の番号で合わせ、パーマリンクと外のリンクは見ない', () => {
    const adrs = new Map<string, Adr>([
      ['0002', { file: '0002-x.md', sections: sections('## 2. 理由\n### 前提\n## 判断\n### 1. 整合\n') }],
    ]);
    // 「 を \u300C で書くのは、このファイル自体も上のテストで読まれ、ここの誤った参照が落ちるため。
    const refs = [
      'ADR-0002 §2\u300C前提」',
      'ADR-0002 §1\u300C整合」',
      '[a](https://github.com/o/r/blob/0123abc/docs/adr/0002-x.md)\u300C無い」',
      '[b](../blob/0123abc/docs/adr/0002-x.md)\u300C無い」',
      'ADR-0002 §3\u300C前提」',
      '[c](../docs/adr/0002-x.md)\u300C無い」',
    ].join('\n');
    expect(brokenSectionRefs('src/x.ts', refs, adrs)).toEqual([
      'src/x.ts:5 ADR-0002 §3\u300C前提」',
      'src/x.ts:6 ](../docs/adr/0002-x.md)\u300C無い」',
    ]);
  });
});
