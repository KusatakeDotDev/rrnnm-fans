import ts from 'typescript';

/**
 * JS のソースから、文字列リテラル（テンプレートリテラルの文字の部分も含む）の中身を取り出す。
 * コメントは読み飛ばす。`/` は直前の字句から正規表現リテラルかどうかを決め、正規表現の中の引用符を
 * 文字列の始まりと取り違えないようにする。
 */
export const stringLiterals = (source: string): string[] => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  const literals: string[] = [];
  // この字句の後ろの `/` は割り算。それ以外の後ろなら正規表現の始まり。
  const endsOperand = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.Identifier,
    ts.SyntaxKind.NumericLiteral,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.CloseParenToken,
    ts.SyntaxKind.CloseBracketToken,
    ts.SyntaxKind.CloseBraceToken,
    ts.SyntaxKind.ThisKeyword,
  ]);
  // 開いているテンプレートの `${` の深さ。`}` がテンプレートの続きかどうかを決める。
  const templateDepth: number[] = [];
  let braces = 0;
  let previous = ts.SyntaxKind.Unknown;
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if ((kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) && !endsOperand.has(previous)) {
      kind = scanner.reScanSlashToken();
    }
    if (kind === ts.SyntaxKind.OpenBraceToken) braces++;
    if (kind === ts.SyntaxKind.CloseBraceToken) {
      if (templateDepth.length > 0 && templateDepth[templateDepth.length - 1] === braces) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === ts.SyntaxKind.TemplateTail) templateDepth.pop();
      } else {
        braces--;
      }
    }
    if (kind === ts.SyntaxKind.TemplateHead) templateDepth.push(braces);
    if (
      kind === ts.SyntaxKind.StringLiteral ||
      kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      kind === ts.SyntaxKind.TemplateHead ||
      kind === ts.SyntaxKind.TemplateMiddle ||
      kind === ts.SyntaxKind.TemplateTail
    ) {
      literals.push(scanner.getTokenValue());
    }
    previous = kind;
  }
  return literals;
};
