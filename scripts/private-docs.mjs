/**
 * 非公開の設計資料（KusatakeDotDev/rrnnm-fans-docs）を docs/ に置く（RRNNM-45）。docs/ は .gitignore で外してある。
 *
 * 使い方:
 *   pnpm docs:pull … 無ければ clone、あれば pull（--ff-only）。https・自分の GitHub の認証で
 *
 * docs を直したら、docs/ の中で commit して、そのリポジトリに push する（PR もそのリポジトリに出す）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const REPOSITORY = 'KusatakeDotDev/rrnnm-fans-docs';
const DIR = 'docs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

if (existsSync(`${DIR}/.git`)) {
  git('-C', DIR, 'pull', '--quiet', '--ff-only');
  console.log(`docs/ を更新した（${REPOSITORY}）`);
} else {
  git('clone', '--quiet', `https://github.com/${REPOSITORY}.git`, DIR);
  console.log(`docs/ に置いた（${REPOSITORY}）`);
}
