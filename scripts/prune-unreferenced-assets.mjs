/**
 * ビルド成果物から、どのページからも参照されないアセットを掃く。
 *
 * **今落ちるのは React の実行時コード（`_astro/client.*.js`、生で約216KB）。**
 * `@astrojs/react` は、クライアントアイランドが1つも無くてもクライアント側のレンダラを書き出す。
 * どの HTML からも参照されないのでブラウザは読まないが、ファイルとしては配られてしまう
 * （docs/adr/0011-react-components-for-design-sync.md）。
 *
 * もとは内部ページ（コンポーネント一覧）を公開用ビルドから落とすスクリプトで、
 * その後始末として「内部ページだけが使っていたアセット」を掃いていた。一覧を Storybook に移して
 * 内部ページが無くなった（rurino-nemo-fansite#96）ので、ページを落とす部分は消し、アセットを掃く部分だけを残した。
 *
 * **落とすものを列挙しない。** 「生きているページから辿り着けないアセットは落とす」という規則にする。
 * 名前で列挙すると、`@astrojs/react` のバージョンアップで出力の名前が変わったときに黙って効かなくなる。
 * 「ルートを列挙しない」（tests/helpers/dist.ts）と同じ考え方。
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url)));

function fail(reason) {
  console.error(`参照されないアセットを掃けなかった: ${reason}`);
  process.exit(1);
}

if (!existsSync(DIST)) {
  fail('dist/ が無い。先に astro build を実行する。');
}

/** ビルド成果物のディレクトリ。ページから参照される CSS などはここに出る。 */
const ASSETS_DIR = '_astro';

/**
 * 中身を読んで参照を探せるファイル。**tests/helpers/dist.ts の並びと合わせる**。
 * 末尾の `''` は拡張子の無いファイル（dist/_headers）。
 *
 * このスクリプトの中で**2種類持たない**。以前は参照を探す側だけが `.json` を見ていて、
 * 最後の検査は見ていなかった。検査ごとに対象ファイルが違うと、
 * 「参照としては数えるが、検査では見ない」ファイルができる。
 */
const TEXT_EXTENSIONS = ['.html', '.js', '.mjs', '.css', '.json', '.txt', '.xml', '.svg', ''];

const isTextFile = (f) => TEXT_EXTENSIONS.includes(path.extname(f));
const inAssetsDir = (f) => path.relative(DIST, f).split(path.sep)[0] === ASSETS_DIR;
const toUrlPath = (f) => path.relative(DIST, f).split(path.sep).join('/');

/**
 * **「誰かに名前を呼ばれているか」では足りない。** それだとアセットが2つあって互いの名前を
 * 含んでいる場合（Vite が分割したチャンクは依存先を名前で持つ）、両方が「参照されている」
 * ことになって永久に残る。誰も辿り着けないのに残る。
 * だから起点を **`_astro/` の外にあるファイル**に固定して、そこから辿れたものだけを残す。
 */
const assets = allFiles(DIST).filter(inAssetsDir);

const reachable = new Set();
const toScan = allFiles(DIST).filter((f) => !inAssetsDir(f) && isTextFile(f));
while (toScan.length > 0) {
  const text = readFileSync(toScan.pop(), 'utf8');
  for (const asset of assets) {
    if (reachable.has(asset) || !text.includes(path.basename(asset))) continue;
    reachable.add(asset);
    // 辿り着いたアセットが更に別のアセットを呼んでいることがある（CSS の @import など）。
    if (isTextFile(asset)) toScan.push(asset);
  }
}

/**
 * 掃きすぎ（公開ページが使っているアセットを落とすこと）は、ここでは確かめない。
 *
 * 落ちるのは、名前が `TEXT_EXTENSIONS` のファイルのどれにも文字のまま出ていないアセットだけ
 * （名前を実行時に組み立てる、並びに無い拡張子のファイルから呼ばれる、など）。
 * 以前は消す前に「残るファイルが、落とすアセットの名前を含んでいないか」を見ていたが、残るテキストのファイルは
 * 上の探索で全部読んでいるので、その検査は必ず空になり、何も捕まえなかった。
 * 気付ける場所は、このスクリプトを通した `pnpm build` の出力でページを開く CI の層2・層3だけ。
 */
const orphans = assets.filter((f) => !reachable.has(f));

for (const f of orphans) {
  rmSync(f, { force: true });
}

if (orphans.length > 0) {
  console.log(`参照されないアセットを落とした: ${orphans.map(toUrlPath).join(', ')}`);
}

function allFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? allFiles(p) : [p];
  });
}
