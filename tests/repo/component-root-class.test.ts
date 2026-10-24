import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

import { componentPathByName } from "../helpers/components";

/**
 * CSS Modules を持つコンポーネントは、root の要素に `.root` を付け、ほかの要素には付けない（RRNNM-77 の主の判断。
 * stylelint.config.mjs の先頭のコメント）。どの規則が root に当たるか（ページが className で渡したクラスが付く要素か）を、
 * 名前で読めるようにするため。root が条件で替わるもの（FieldValue）は、どの形の root にも付ける。
 * root が別のコンポーネントのとき（値の無い FieldValue の UnknownChip）は、そのコンポーネントの `.root` が付くので見ない。
 *
 * コンポーネントの名前は持たない。src/components と src/unreleased の `.tsx` を読み、構文木で default export の関数が
 * 返す要素を見る（ファイルの中の関数を呼んで返すもの（NemophilaField の renderField）は、その関数の返す要素を見る）。
 */
const path = (relPath: string) => fileURLToPath(new URL(`../../${relPath}`, import.meta.url));

const isDefaultExport = (node: ts.Node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) &&
  (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** 関数が返す、いちばん外の JSX の要素。ファイルの中の関数の呼び出しは、その関数の中まで辿る。 */
function returnedElements(
  sf: ts.SourceFile,
  fn: ts.FunctionLikeDeclaration,
): ts.JsxOpeningLikeElement[] {
  const local = new Map(
    sf.statements
      .filter(ts.isFunctionDeclaration)
      .flatMap((d) => (d.name ? [[d.name.text, d] as const] : [])),
  );
  const out: ts.JsxOpeningLikeElement[] = [];
  const unwrap = (expr: ts.Expression): void => {
    if (ts.isParenthesizedExpression(expr)) return unwrap(expr.expression);
    if (ts.isConditionalExpression(expr)) return (unwrap(expr.whenTrue), unwrap(expr.whenFalse));
    if (ts.isJsxElement(expr)) return void out.push(expr.openingElement);
    if (ts.isJsxSelfClosingElement(expr)) return void out.push(expr);
    if (
      ts.isCallExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      local.has(expr.expression.text)
    ) {
      return void out.push(...returnedElements(sf, local.get(expr.expression.text)!));
    }
    throw new Error(`${sf.fileName}: 返す要素を読めない（${expr.getText().slice(0, 60)}）`);
  };
  const visit = (node: ts.Node): void => {
    if (node !== fn && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) unwrap(node.expression);
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return out;
}

const classNameOf = (el: ts.JsxOpeningLikeElement) =>
  el.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "className",
  );

const components = Object.entries(componentPathByName)
  .map(([name, file]) => ({ name, file, css: file.replace(/\.tsx$/, ".module.css") }))
  .filter(({ css }) => existsSync(path(css)));

describe("CSS Modules を持つコンポーネントは、root の要素に .root を付ける", () => {
  it("見るコンポーネントがある", () => {
    expect(components.length).toBeGreaterThan(0);
  });

  it.each(components)("$name", ({ file, css }) => {
    const sf = ts.createSourceFile(
      file,
      readFileSync(path(file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const fn = sf.statements.find(
      (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && isDefaultExport(s),
    );
    expect(fn, "default export の関数").toBeDefined();

    // root が別のコンポーネント（className を渡さない大文字のタグ）なら、そのコンポーネントの .root が付く。
    const roots = returnedElements(sf, fn!).filter(
      (el) => classNameOf(el) || !/^[A-Z]/.test(el.tagName.getText()),
    );
    expect(roots.length, "返す要素").toBeGreaterThan(0);
    for (const el of roots) {
      expect(
        classNameOf(el)?.initializer?.getText() ?? "",
        `<${el.tagName.getText()}> の className`,
      ).toMatch(/\bstyles\.root\b/);
    }

    const withRoot: ts.JsxOpeningLikeElement[] = [];
    const visit = (node: ts.Node): void => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        /\bstyles\.root\b/.test(classNameOf(node)?.getText() ?? "")
      ) {
        withRoot.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(
      withRoot.filter((el) => !roots.includes(el)).map((el) => el.getText().slice(0, 60)),
      "root の外で .root を付けた要素",
    ).toEqual([]);

    expect(readFileSync(path(css), "utf8"), `${css} に .root`).toMatch(/\.root(?![\w-])/);
  });
});
