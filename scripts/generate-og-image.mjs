/**
 * SNS に貼られたときの画像（OGP の og:image）を作り直す。サイト全体で1枚。
 *
 * `pnpm build` からは呼ばない。**手動で実行するスクリプト**で、生成した PNG をコミットする
 * （ロゴか色を変えたときだけ回す）。
 * 絵を組むのは scripts/og-image-svg.ts で、ここはそれを PNG にして書き出すだけ。
 *
 * 書き出す先の名前と大きさは src/layouts/og-image.ts の OG_IMAGE（Base.astro の og:image も同じものを読む）。
 * **ファイル名には日付が入っている**（`site.YYYYMMDD.png`）。SNS は画像を URL ごとにキャッシュするので、
 * 絵を差し替えるときは名前も変える。絵が変わったかは、絵のフィンガープリント（OG_IMAGE.hash）で見る。
 *   - その名前のファイルがまだ無い → 書き出す
 *   - あって、絵が同じ → 何もしない
 *   - あって、絵が変わった、名前の日付が今日 → 書き直す（作業中に何度も直すため）
 *   - あって、絵が変わった、名前の日付が前の日 → 書き出さずに止まる。OG_IMAGE の日付を今日にしてから回し直す
 * 書き出したら、OG_IMAGE.hash を書き換え、public/og/ の前の日付の画像を消す（どのページからも指されなくなる）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { LOGO_OUTLINED } from "../src/components/site-assets.ts";
import { OG_IMAGE } from "../src/layouts/og-image.ts";
import { composeOgImageSvg, ogImageHash, PNG_OPTIONS } from "./og-image-svg.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LOGO_PATH = path.join(ROOT, "public", LOGO_OUTLINED);
const TOKENS_PATH = path.join(ROOT, "src/styles/tokens.css");
const OG_IMAGE_TS = path.join(ROOT, "src/layouts/og-image.ts");
const OUT_PATH = path.join(ROOT, "public", OG_IMAGE.path);
const OUT_DIR = path.dirname(OUT_PATH);

function fail(reason) {
  console.error(`OGP の画像を作り直せなかった: ${reason}`);
  process.exit(1);
}

/** 名前を「前置き.YYYYMMDD.png」に分ける。前置きは、消してよい古い画像を見分けるのに使う。 */
const nameMatch = path.basename(OUT_PATH).match(/^(.+)\.(\d{8})\.png$/);
if (!nameMatch) fail(`OG_IMAGE.path（${OG_IMAGE.path}）が「名前.YYYYMMDD.png」の形でない`);
const [, stem, date] = nameMatch;

const now = new Date();
const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

let svg;
try {
  svg = composeOgImageSvg({
    tokensCss: readFileSync(TOKENS_PATH, "utf8"),
    logoSvg: readFileSync(LOGO_PATH, "utf8"),
  });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const hash = ogImageHash(svg);

// フィンガープリントを書き換える行（hash の1行）を、PNG を書く前に確かめる。後で見つからないと、PNG だけが新しくなる。
const ogImageTs = readFileSync(OG_IMAGE_TS, "utf8");
const hashLine = /^(\s*hash: ')[0-9a-f]*(',)$/m;
if (!hashLine.test(ogImageTs))
  fail(`${path.relative(ROOT, OG_IMAGE_TS)} に hash の行が見つからない`);

const outRel = path.relative(ROOT, OUT_PATH);
if (existsSync(OUT_PATH)) {
  if (hash === OG_IMAGE.hash) {
    console.log(`${outRel} は今の絵と同じ。書き直さない`);
    process.exit(0);
  }
  if (date !== today) {
    fail(
      `${outRel} と絵が変わった。同じ名前のまま差し替えると、SNS が古い絵を出し続けることがある。` +
        `src/layouts/og-image.ts の OG_IMAGE.path の日付を今日（${today}）にしてから回し直す`,
    );
  }
  console.log(`${outRel} は今日の日付なので、同じ名前のまま書き直す`);
}

const { data: png, info } = await sharp(Buffer.from(svg))
  .png(PNG_OPTIONS)
  .toBuffer({ resolveWithObject: true });
if (info.width !== OG_IMAGE.width || info.height !== OG_IMAGE.height) {
  fail(
    `出力が ${info.width}×${info.height} になった（${OG_IMAGE.width}×${OG_IMAGE.height} を想定）`,
  );
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, png);
console.log(
  `${outRel}（${info.width}×${info.height}、${(png.length / 1024).toFixed(1)} KiB）を書いた`,
);

// フィンガープリントを書き換える。書き換えるのは hash の1行だけ。
writeFileSync(OG_IMAGE_TS, ogImageTs.replace(hashLine, `$1${hash}$2`));

// 前の日付の画像は、どのページからも指されなくなる。残すと公開物に死んだファイルが溜まる。
// 消すのは同じ前置きで日付だけが違うものに限る。ほかの用途で置いた画像は消さない。
const sameStem = (name) =>
  name.startsWith(`${stem}.`) && /^\d{8}\.png$/.test(name.slice(stem.length + 1));
for (const name of readdirSync(OUT_DIR)) {
  if (sameStem(name) && name !== path.basename(OUT_PATH)) {
    rmSync(path.join(OUT_DIR, name));
    console.log(`古い ${path.relative(ROOT, path.join(OUT_DIR, name))} を消した`);
  }
}
