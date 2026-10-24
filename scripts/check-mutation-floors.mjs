/**
 * ミューテーションテストのスコアを、ファイルごとに下限と比べる（ADR-0003「閾値」）。Stryker の閾値は全体のスコアにしか
 * 効かず、1つのモジュールのテストを消しても、ほかのファイルの分で全体が下限を割らないため。
 *
 * 使い方: pnpm test:mutation のあとに pnpm test:mutation:floors（Stryker の json のレポーターが書いたレポートを読む）
 * 終了コード: 0 = どのファイルも下限以上 / 1 = 下限を割ったファイルか、下限の表にあってレポートに無いファイルがある
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REPORT = "reports/mutation/mutation.json";

/** 表に無いファイルにも掛ける。足したばかりのモジュールも、テストが無ければ割るようにするため。値の決め方は ADR-0003「閾値」。 */
export const DEFAULT_FLOOR = 95;

/** 既定に届かないファイルだけを、理由のコメントを添えて置く（ADR-0003「閾値」の、下限を下げる手）。パスはリポジトリのルートから。 */
export const FLOORS = {};

const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

/** Stryker の mutation score と同じ数え方。Ignored・CompileError・RuntimeError は分母に入れない。 */
export function fileScores(report) {
  return Object.entries(report.files).map(([path, { mutants }]) => {
    const detected = mutants.filter((m) => DETECTED.has(m.status)).length;
    const valid = detected + mutants.filter((m) => UNDETECTED.has(m.status)).length;
    return {
      path: path.replaceAll("\\", "/"),
      valid,
      score: valid === 0 ? null : (detected / valid) * 100,
    };
  });
}

export function checkFloors(scores, { defaultFloor = DEFAULT_FLOOR, floors = FLOORS } = {}) {
  const rows = scores.map((s) => ({ ...s, floor: floors[s.path] ?? defaultFloor }));
  // NaN を通さないよう、「下限以上」でないものを落とす。
  const below = rows.filter((r) => r.score !== null && !(r.score >= r.floor));
  const unknown = Object.keys(floors).filter((path) => !rows.some((r) => r.path === path));
  return { rows, below, unknown };
}

function main(reportPath = REPORT) {
  const { rows, below, unknown } = checkFloors(
    fileScores(JSON.parse(readFileSync(reportPath, "utf8"))),
  );
  for (const r of rows) {
    const score = r.score === null ? "   n/a " : `${r.score.toFixed(2).padStart(6)}%`;
    const mark = below.includes(r) ? "NG" : "ok";
    console.log(`${mark} ${score}（下限 ${r.floor}）${r.path}`);
  }
  for (const path of unknown)
    console.error(
      `下限の表にあるが、レポートに無い: ${path}（ファイルを消した・名前を変えたなら、表からも消す）`,
    );
  if (below.length > 0) {
    console.error(`下限を割ったファイルがある: ${below.map((r) => r.path).join(", ")}`);
    console.error(
      "生き残りを倒すテストを書くか、倒せないものはその行の直前に `// Stryker disable next-line <mutator>: <理由>` を置く（ADR-0003「閾値」）",
    );
  }
  return below.length === 0 && unknown.length === 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv[2]) ? 0 : 1;
}
