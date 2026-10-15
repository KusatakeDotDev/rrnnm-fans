// pnpm skeb:summary prepare|apply|review|approve <URL> <resultHash>|retry <URL>|publish
// 終了コード: 0 成功、1 入力・状態・操作エラー。通信や AI の起動は行わない。
import { mkdir, readFile, writeFile, rename, unlink, rmdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { SKEB_WORKS } from '../src/content/skeb.ts';
import { object, validateSummaryData } from '../src/lib/skeb-summary.ts';
import type { SummaryData } from '../src/lib/skeb-summary.ts';
import { inputHash, prepare, publish, readDescription, restoreState, resultHash, tasks, validateInput, validateResult, validateState } from './skeb-summary-core.ts';
import type { Input, State } from './skeb-summary-core.ts';

const empty = (): State => ({ version: 2, inputs: [], results: [], approvals: [] });
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown;

async function atomic(path: string, value: unknown) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (await readFile(path, 'utf8').catch(() => '') === text) return;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function run(root: string, urls: readonly string[], args: string[]) {
  const directory = resolve(root, '.local/skeb');
  await mkdir(directory, { recursive: true });
  const actualDirectory = await realpath(directory);
  if (actualDirectory !== directory) throw new Error('Private directory must not be a symlink');
  const lock = resolve(directory, 'lock');
  await mkdir(lock).catch(() => { throw new Error('Another command is running; inspect .local/skeb/lock before retrying'); });
  const output = resolve(root, 'src/content/skeb-summaries.json');
  const stateFile = resolve(directory, 'state.json');
  const journalFile = resolve(directory, 'update.json');
  // 先に次の状態を私有journalへ保存する。中断後は旧stateを読む前に同じ更新を完了する。
  const save = async (state: State) => {
    await atomic(journalFile, state);
    await atomic(output, publish(state, urls));
    await atomic(stateFile, state);
    await atomic(resolve(directory, 'tasks.json'), tasks(state));
    const review = state.results.filter((r) => r.status === 'generated').map((result) => ({
      ...result, resultHash: resultHash(result), approved: state.approvals.includes(resultHash(result)),
      sourceTags: state.inputs.find((input) => input.url === result.url)?.sourceTags ?? [],
    }));
    await atomic(resolve(directory, 'review.json'), review);
    await unlink(journalFile);
  };
  const clearDerived = async () => {
    await atomic(output, publish(empty(), urls));
    await atomic(resolve(directory, 'tasks.json'), []);
    await atomic(resolve(directory, 'review.json'), []);
  };
  const privateFile = async (name: string) => {
    if (typeof name !== 'string' || !name || isAbsolute(name)) throw new Error('Expected private relative file path');
    const path = await realpath(resolve(directory, name));
    const within = relative(actualDirectory, path);
    if (within.startsWith('..') || isAbsolute(within)) throw new Error('Input must stay inside .local/skeb');
    const stat = await import('node:fs/promises').then((fs) => fs.stat(path));
    if (!stat.isFile() || stat.size > 2_000_000) throw new Error('Input file too large or not a file');
    return path;
  };
  try {
    let interrupted: unknown;
    try { interrupted = await json(journalFile); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await clearDerived();
        throw error;
      }
    }
    if (interrupted !== undefined) {
      let next: State;
      try { next = validateState(interrupted, urls); }
      catch (error) { await clearDerived(); throw error; }
      await save(next);
    }
    let state: State;
    let recovery: SummaryData | undefined;
    try { state = restoreState(await json(stateFile), urls); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (args[0] === 'prepare') await clearDerived();
        throw error;
      }
      state = empty();
      try { recovery = validateSummaryData(await json(output), urls); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (recovery?.works.some((work) => work.status !== 'missing') && args[0] !== 'prepare') {
        throw new Error('Private state is missing; restore it or run prepare with the existing local inputs first');
      }
    }
    const [command, url, receipt] = args;
    if (command === 'prepare' && args.length === 1) {
      try {
        const manifest = await json(await privateFile('inputs.json'));
        if (!Array.isArray(manifest)) throw new Error('Expected input manifest array');
        const inputs: Input[] = [];
        for (const item of manifest) {
          object(item, ['url', 'file', 'format']);
          if (typeof item.url !== 'string' || !urls.includes(item.url) || typeof item.file !== 'string') throw new Error('Invalid manifest entry');
          const path = await privateFile(item.file);
          let input: Input;
          if (item.format === 'html') input = validateInput({ url: item.url, description: readDescription(await readFile(path, 'utf8')) }, urls);
          else if (item.format === 'metadata') {
            input = validateInput(await json(path), urls);
            if (input.url !== item.url) throw new Error('Metadata URL mismatch');
          } else throw new Error('Expected html or metadata format');
          inputs.push(input);
        }
        state = validateState(prepare(inputs, state), urls);
        if (recovery) {
          for (const work of recovery.works.filter((work) => work.status === 'approved' || work.status === 'failed')) {
            const input = inputs.find((input) => input.url === work.url);
            if (!input) throw new Error('Recovery requires local inputs for published works');
            if (inputHash(input) !== work.inputHash) continue;
            const result = validateResult({
              url: work.url, inputHash: work.inputHash,
              status: work.status === 'approved' ? 'generated' : 'failed',
              ...(work.status === 'approved' ? { summary: work.summary } : {}),
            }, inputs);
            state.results.push(result);
            if (result.status === 'generated') state.approvals.push(resultHash(result));
          }
        }
      } catch (error) {
        if (!recovery) {
          // 復元中でなければ、読めない入力に対応する古い要約を残さない。
          await save(empty());
        }
        throw error;
      }
    } else if (command === 'apply' && args.length === 1) {
      const values = await json(await privateFile('results.json'));
      if (!Array.isArray(values)) throw new Error('Expected results array');
      const results = values.map((value) => validateResult(value, state.inputs));
      if (new Set(results.map((r) => r.url)).size !== results.length) throw new Error('Duplicate result');
      state.results = state.results.filter((old) => !results.some((r) => r.url === old.url)).concat(results);
      state.approvals = state.approvals.filter((approval) => state.results.some((r) => resultHash(r) === approval));
    } else if (command === 'approve' && args.length === 3) {
      const result = state.results.find((r) => r.url === url && r.status === 'generated' && resultHash(r) === receipt);
      if (!result) throw new Error('Review receipt does not match a generated result');
      state.approvals = [...new Set([...state.approvals, receipt])];
    } else if (command === 'retry' && args.length === 2) {
      if (!state.inputs.some((input) => input.url === url)) throw new Error('Unknown input');
      state.results = state.results.filter((r) => r.url !== url);
      state.approvals = state.approvals.filter((approval) => state.results.some((r) => resultHash(r) === approval));
    } else if (!(['review', 'publish'].includes(command) && args.length === 1)) {
      throw new Error('Usage: prepare|apply|review|approve <URL> <resultHash>|retry <URL>|publish');
    }
    state = validateState(state, urls);
    await save(state);
    return { tasks: tasks(state).length, generated: state.results.filter((r) => r.status === 'generated').length, approved: state.approvals.length };
  } finally {
    await rmdir(lock);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  run(root, SKEB_WORKS.map((work) => work.url), process.argv.slice(2))
    .then((counts) => console.log(JSON.stringify(counts)))
    .catch(() => { console.error('Skeb task failed. Check private inputs/state and command arguments; no source text is logged.'); process.exitCode = 1; });
}
