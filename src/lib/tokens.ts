/**
 * CSS カスタムプロパティの読み取りと `var()` の解決。tokens.css の実物から色を読む（パレットの検査・OGP の画像・Storybook。
 * ADR-0003「層1が `tokens.css` を読む理由」）。ファイルは読まず、CSS のテキストを受け取る。
 */

/** `var(--x, fallback)` は扱わない。tokens.css が使っていない形を実装しない。 */
const CUSTOM_PROPERTY = /(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g;
const VAR_REFERENCE = /var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g;
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;

/** `var()` を解く深さの上限。これを超えたら循環参照とみなす。 */
const MAX_RESOLVE_DEPTH = 16;

/** CSS のコメントを外す。コメントの中の `--x: y;` を拾わないために要る。 */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * カスタムプロパティを全部拾う。同じ名前が複数回出たら後勝ち（CSS の規則と同じ）。
 * 値の中の改行と連続する空白は1つに畳む（書体スタックが複数行に跨るため）。
 */
export function parseCustomProperties(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const [, name, value] of stripComments(css).matchAll(CUSTOM_PROPERTY)) {
    tokens.set(name!, value!.trim().replace(/\s+/g, ' '));
  }
  return tokens;
}

/** `var()` を最後まで解いた値。未定義のトークンと循環参照は投げる。 */
export function resolve(tokens: ReadonlyMap<string, string>, name: string): string {
  let value = read(tokens, name);
  for (let depth = 0; depth < MAX_RESOLVE_DEPTH; depth += 1) {
    if (!value.includes('var(')) return value;
    value = value.replace(VAR_REFERENCE, (_, ref: string) => read(tokens, ref));
  }
  throw new Error(`var() の参照が深すぎる。循環している可能性がある: ${name}`);
}

function read(tokens: ReadonlyMap<string, string>, name: string): string {
  const value = tokens.get(name);
  if (value === undefined) {
    throw new Error(`未定義のトークン: ${name}`);
  }
  return value;
}

/** 値に16進数の色が直接書かれているか。役割トークンの検査に使う。 */
export function hasHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}
