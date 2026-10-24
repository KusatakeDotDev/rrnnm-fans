/**
 * 非公開の素材（scripts/private-assets.json の repository）を、固定したコミット（ref）で取ってきて、
 * このリポジトリの同じパスに重ねる（RRNNM-44）。重ねたファイルは .gitignore で外してある。
 *
 * 使い方:
 *   pnpm assets:pull    … 手元。.private/assets に clone・fetch して重ねる（https。自分の GitHub の認証で）
 *   pnpm assets:overlay … CI。取ってくるのは actions/checkout（.github/actions/private-assets）。重ねるだけ
 *
 * 重ねた先が .gitignore で外れていなければ、止める。素材のリポジトリにファイルを足したときに、
 * 公開リポジトリへうっかりコミットしないため。
 * 前に重ねたファイルの一覧（.private/overlay.json）にあって今の ref に無いものは消す。ref を上げたあとも、
 * 消えた・名前の変わったファイルが手元に残り、固定したコミットと食い違わないため。
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const { repository, ref } = JSON.parse(
  readFileSync(new URL("./private-assets.json", import.meta.url), "utf8"),
);
const DIR = ".private/assets";
const MANIFEST = ".private/overlay.json";
// 素材のリポジトリの説明で、重ねるものではない。
const SKIP = new Set(["README.md", ".gitattributes"]);

// git は、チェックアウトの持ち主と実行ユーザーが違うと止まる（dubious ownership）。リリースのジョブはコンテナの root で動く。
const git = (...args) =>
  execFileSync("git", ["-c", "safe.directory=*", ...args], { encoding: "utf8" });

if (!process.argv.includes("--overlay-only")) {
  if (!existsSync(path.join(DIR, ".git")))
    git("clone", "--quiet", "--no-checkout", `https://github.com/${repository}.git`, DIR);
  git("-C", DIR, "fetch", "--quiet", "origin", ref);
  git("-C", DIR, "checkout", "--quiet", "--detach", ref);
}

const files = git("-C", DIR, "ls-files", "-z")
  .split("\0")
  .filter((file) => file && !SKIP.has(file));
const notIgnored = files.filter((file) => {
  try {
    git("check-ignore", "--quiet", "--no-index", file);
    return false;
  } catch {
    return true;
  }
});
if (notIgnored.length > 0) {
  console.error(
    `.gitignore で外れていないので重ねない（.gitignore に足す）:\n  ${notIgnored.join("\n  ")}`,
  );
  process.exit(1);
}

const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : [];
const stale = previous.filter((file) => !files.includes(file));
for (const file of stale) rmSync(file, { force: true });
for (const file of files) {
  // 前の ref でフォルダだったパスがファイルになっていると、残ったフォルダにコピーできない。重ね先はどれも .gitignore の中。
  if (existsSync(file) && statSync(file).isDirectory())
    rmSync(file, { recursive: true, force: true });
  mkdirSync(path.dirname(file), { recursive: true });
  copyFileSync(path.join(DIR, file), file);
}
writeFileSync(MANIFEST, `${JSON.stringify(files, null, 2)}\n`);
const head = git("-C", DIR, "rev-parse", "--short=7", "HEAD").trim();
console.log(
  `非公開の素材を ${files.length} 件重ねた（${repository}@${head}）${stale.length ? `。前に重ねた ${stale.length} 件を消した` : ""}`,
);
