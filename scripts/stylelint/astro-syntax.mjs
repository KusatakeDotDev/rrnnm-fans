// Stylelint に .astro の <style> を読ませる構文（ADR-0025「依存は、ADR-0016 の4項目を添えて主に聞いた」の、自前の構文）。
// postcss-html は個人のアカウントのリポジトリにあり、<style> を読むだけならこの数行で足りるため、使わない。
import postcss from 'postcss';

// 行の頭（インデントは許す）の <style> だけを拾う。frontmatter のコメントや文字列に書いた `<style>` を、CSS の始まりと読まないため。
// 自分で閉じる `<style … />`（中身を set:html で入れる）も拾わない。拾うと、次の </style> までのマークアップを CSS として読む。
const STYLE = /^[ \t]*<style\b(?:[^>/]|\/(?!>))*>([\s\S]*?)^[ \t]*<\/style>/gm;

/**
 * <style> ごとに PostCSS の Root を作り、1つの Document にまとめる（Stylelint は Root ごとに lint する）。
 * 外側の文字は改行を残して空白に替えてから読む。行と桁が .astro のままになり、違反の場所がそのまま指せる。
 */
function parse(code, options = {}) {
  const document = postcss.document();
  document.source = { input: new postcss.Input(code, options), start: { line: 1, column: 1, offset: 0 } };
  document.raws.astro = code;
  for (const match of code.matchAll(STYLE)) {
    const start = match.index + match[0].indexOf('>') + 1;
    const end = start + match[1].length;
    const blanked = code.slice(0, start).replace(/[^\n]/g, ' ') + match[1] + code.slice(end).replace(/[^\n]/g, ' ');
    document.append(postcss.parse(blanked, options));
  }
  return document;
}

// 書き出しは --fix のときだけ使われ、このリポジトリでは使わない。読んだ .astro をそのまま返す。
function stringify(node, builder) {
  builder(node.type === 'document' ? node.raws.astro : node.toString());
}

export default { parse, stringify };
