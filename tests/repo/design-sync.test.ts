import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { componentPathByName } from "../helpers/components";

/**
 * Claude Design への同期（/design-sync）の設定が、コンポーネントと食い違っていないか。
 *
 * 同期するコンポーネントの一覧は `.design-sync/entry.ts`（バンドルに書き出す export）と
 * `.design-sync/config.json` の `componentSrcMap`（型と見本の対応）の2か所にある。
 * どちらかだけ直しても型検査もビルドも通り、同期のときに黙って抜けるか、
 * 見本が空になる。`.design-sync/` はドットのディレクトリなので、
 * ルートの tsconfig.json の `**\/*` にも入らず、`astro check` も見ない。
 *
 * story-coverage.test.ts と同じく**コンポーネントの名前を持たない。** ディレクトリと設定を読んで突き合わせる。
 * コンポーネントを `.tsx` に移したら、この検査が同期への登録と型の名前を求める
 * （docs/adr/0011-react-components-for-design-sync.md「props の決まり」）。
 */
const path = (relPath: string) => fileURLToPath(new URL(`../../${relPath}`, import.meta.url));
const read = (relPath: string) => readFileSync(path(relPath), "utf8");

const entry = read(".design-sync/entry.ts");
const config = JSON.parse(read(".design-sync/config.json")) as {
  componentSrcMap?: Record<string, string | null>;
};
const srcMap = config.componentSrcMap ?? {};

// `export { default as Card } from "../src/components/Card.tsx";` の Card と、ファイルの名前。
const exports = [
  ...entry.matchAll(
    /^export \{ default as (\w+) \} from ['"]\.\.\/(src\/(?:components|unreleased)\/[^'"]+)['"];$/gm,
  ),
].map(([, name, file]) => ({ name, file }));

const tsxComponents = Object.keys(componentPathByName).sort();

// 各 .tsx は1回だけ読んで構文木にする。型の名前と default export の引数は、
// 正規表現ではなく TypeScript の構文木で読む（関数の本体をまたいで一致しないように）。
const sources = new Map(
  tsxComponents.map((name) => {
    const file = componentPathByName[name]!;
    return [
      name,
      ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    ] as const;
  }),
);

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

/** トップレベルで宣言された interface・type の名前。 */
const declaredTypeNames = (sf: ts.SourceFile) =>
  sf.statements
    .filter(
      (s): s is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
        ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s),
    )
    .map((s) => s.name.text);

/** default export の関数の、最初の引数の型注釈の名前（型の参照でなければ undefined）。 */
const defaultExportParamType = (sf: ts.SourceFile): string | undefined => {
  let fn: ts.SignatureDeclaration | undefined;
  for (const s of sf.statements) {
    if (
      ts.isFunctionDeclaration(s) &&
      hasModifier(s, ts.SyntaxKind.ExportKeyword) &&
      hasModifier(s, ts.SyntaxKind.DefaultKeyword)
    ) {
      fn = s;
    } else if (ts.isExportAssignment(s) && !s.isExportEquals && ts.isIdentifier(s.expression)) {
      // `export default Card;` の形。同じファイルの関数か、関数を入れた const を探す。
      const target = s.expression.text;
      for (const d of sf.statements) {
        if (ts.isFunctionDeclaration(d) && d.name?.text === target) fn = d;
        if (ts.isVariableStatement(d)) {
          for (const v of d.declarationList.declarations) {
            if (
              ts.isIdentifier(v.name) &&
              v.name.text === target &&
              v.initializer &&
              (ts.isArrowFunction(v.initializer) || ts.isFunctionExpression(v.initializer))
            ) {
              fn = v.initializer;
            }
          }
        }
      }
    }
  }
  const type = fn?.parameters[0]?.type;
  return type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)
    ? type.typeName.text
    : undefined;
};

describe(".design-sync/ — Claude Design への同期の設定", () => {
  it("entry.ts がコンポーネントを1つ以上書き出している", () => {
    // 正規表現が書き方の変化で何も拾わなくなると、以下の検査が全部素通りする。
    expect(exports.length).toBeGreaterThan(0);
    expect(tsxComponents.length).toBeGreaterThan(0);
  });

  it("entry.ts が書き出すコンポーネントと、componentSrcMap で同期するコンポーネントが同じ", () => {
    const exported = exports.map((e) => e.name).sort();
    const mapped = Object.entries(srcMap)
      .filter(([, file]) => typeof file === "string")
      .map(([name]) => name)
      .sort();
    expect(exported).toEqual(mapped);
  });

  it("書き出す名前・componentSrcMap のパス・ファイル名が一致し、ファイルが実在する", () => {
    const mismatched = exports.filter(
      (e) =>
        e.file !== componentPathByName[e.name!] ||
        srcMap[e.name!] !== e.file ||
        !existsSync(path(e.file!)),
    );
    expect(mismatched).toEqual([]);
  });

  it("src/components の .tsx はどれも componentSrcMap に載っている（載せないなら null と明示する）", () => {
    // 移したコンポーネントの登録漏れを止める。null は「同期しない」と決めた印（例: 中身を外部のスクリプトが差し込むコンポーネント）。
    // `in` だと constructor などプロトタイプの名前でも真になるので、自分のキーだけを見る。
    const missing = tsxComponents.filter((name) => !Object.hasOwn(srcMap, name));
    expect(missing).toEqual([]);
  });

  it("componentSrcMap のキーはどれも src/components の .tsx として実在する", () => {
    // 逆向き。コンポーネントを消したり名前を変えたりしたあと、null の項目は entry.ts との突き合わせにかからず残り続ける。
    const orphaned = Object.keys(srcMap).filter((name) => !tsxComponents.includes(name));
    expect(orphaned).toEqual([]);
  });

  it("src/components の .tsx はどれも <ファイル名>Props を宣言している", () => {
    // 同期の変換はこの名前で props の型を探す。見つからないと Claude Design に渡る API が
    // 黙って空（[key: string]: unknown）になり、型検査にも同期の検査にも出ない。
    const missing = tsxComponents.filter(
      (name) => !declaredTypeNames(sources.get(name)!).includes(`${name}Props`),
    );
    expect(missing).toEqual([]);
  });

  it("src/components の .tsx はどれも default export の引数の型が <ファイル名>Props", () => {
    // 名前を宣言しただけで、関数の引数を別の型（古い Props など）で書くと、変換は宣言の方を
    // props として読み、Claude Design に渡る API が実物と食い違う。引数の型まで見て止める。
    const mismatched = tsxComponents.filter(
      (name) => defaultExportParamType(sources.get(name)!) !== `${name}Props`,
    );
    expect(mismatched).toEqual([]);
  });
});

describe(".design-sync/site-assets.ts — 画像の差し替え", () => {
  // コンポーネントは画像のパスをエイリアス `@site-assets` で読む。サイトでは src/components/site-assets.ts、
  // 同期では .design-sync/site-assets.ts（画像をバンドルに埋め込む版）がその行き先になる。
  // 片方にだけ名前を足しても型検査は通る（コンポーネントが見るのはサイトの版の型だけで、
  // .design-sync/ は型検査の外）。同期のバンドルでだけ src が undefined になり、画像が黙って消える。
  // 名前だけでなく、指す画像も比べる。コピペで別の画像を指すと、同期先でだけロゴが入れ替わる。
  // どちらも「名前 → public/ からのパス」の対応にして突き合わせる。
  const byName = (pairs: [string, string][]) =>
    Object.fromEntries([...pairs].sort(([a], [b]) => a.localeCompare(b)));

  // サイトの版: export const LOGO = "/logo/x.svg";（public/ の下はサイトのルート）
  const site = byName(
    [
      ...read("src/components/site-assets.ts").matchAll(
        /^export const (\w+) = ['"]\/([^'"]+)['"];$/gm,
      ),
    ].map(([, name, path]) => [name, path]),
  );
  // 同期の版: export { default as LOGO } from "../public/logo/x.svg";
  const sync = byName(
    [
      ...read(".design-sync/site-assets.ts").matchAll(
        /^export \{ default as (\w+) \} from ['"]\.\.\/public\/([^'"]+)['"];$/gm,
      ),
    ].map(([, name, path]) => [name, path]),
  );

  it("両方の版が画像を1つ以上書き出している", () => {
    // 正規表現が書き方の変化で何も拾わなくなると、下の検査が素通りする。
    expect(Object.keys(site).length).toBeGreaterThan(0);
    expect(Object.keys(sync).length).toBeGreaterThan(0);
  });

  it("どちらの版も、読めない形の export を持たない", () => {
    // 上の正規表現に合わない書き方の export は、突き合わせから静かに抜ける。数で押さえる。
    const count = (relPath: string) => (read(relPath).match(/^export /gm) ?? []).length;
    expect(count("src/components/site-assets.ts")).toBe(Object.keys(site).length);
    expect(count(".design-sync/site-assets.ts")).toBe(Object.keys(sync).length);
  });

  it("サイトの版と同期の版が、同じ名前で同じ画像を指している", () => {
    expect(sync).toEqual(site);
  });

  it("指している画像が public/ にある", () => {
    // 2つの版を同じ古いパスに揃えたまま画像を消すと、上の突き合わせは通るが、
    // サイトの <img> は 404 になり、同期は esbuild の解決エラーで初めて落ちる。
    const missing = Object.values(site).filter((p) => !existsSync(path(`public/${p}`)));
    expect(missing).toEqual([]);
  });
});

describe(".design-sync/tsconfig.sync.json — エイリアスの差し替え", () => {
  // 同期の変換は config.json の tsconfig が指すファイルの compilerOptions.paths だけを読み
  // （extends はたどらない）、読む前に `//` から行末までを消す。ここが壊れても型検査も
  // 単体テストも通り、同期のバンドルでだけエイリアスが効かず、Claude Design でロゴが黙って消える。
  // 変換と同じ読み方で読んで確かめる（.design-sync/NOTES.md「載せていないもの」）。
  const readLikeConverter = (relPath: string) =>
    JSON.parse(
      read(relPath)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1"),
    ) as { compilerOptions?: { paths?: Record<string, string[]> } };

  it("config.json の tsconfig が tsconfig.sync.json を指している", () => {
    expect(JSON.parse(read(".design-sync/config.json")).tsconfig).toBe(
      ".design-sync/tsconfig.sync.json",
    );
  });

  it("変換と同じ読み方で読め、@site-assets が同期の版を指している", () => {
    const paths = readLikeConverter(".design-sync/tsconfig.sync.json").compilerOptions?.paths ?? {};
    expect(paths["@site-assets"]).toEqual(["./site-assets.ts"]);
  });

  it("ルートの tsconfig.json のエイリアスが、全部こちらにもある", () => {
    // paths は extends でもまとめられず丸ごと置き換わるので、ルートに足したエイリアスは写す必要がある。
    const root = Object.keys(readLikeConverter("tsconfig.json").compilerOptions?.paths ?? {});
    const sync = Object.keys(
      readLikeConverter(".design-sync/tsconfig.sync.json").compilerOptions?.paths ?? {},
    );
    expect(root.filter((k) => !sync.includes(k))).toEqual([]);
  });
});
