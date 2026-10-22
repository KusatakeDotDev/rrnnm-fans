// stylelint.config.mjs が読む自前のルール。決まりの本文となぜは、そのファイルの先頭のコメントにある。
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';
import stylelint from 'stylelint';

const {
  createPlugin,
  utils: { report, ruleMessages },
} = stylelint;

function plugin(name, message, check) {
  const ruleName = `rrnnm/${name}`;
  const messages = ruleMessages(ruleName, { rejected: message });
  const rule = (primary, secondary) => (root, result) => {
    if (primary !== true) return;
    check(root, result, (node) => report({ result, ruleName, message: messages.rejected, node }), secondary ?? {});
  };
  rule.ruleName = ruleName;
  rule.messages = messages;
  return createPlugin(ruleName, rule);
}

const nests = (node) => node.type === 'rule' || node.type === 'atrule';

const noNesting = plugin(
  'no-nesting',
  'ルールの中に、ルールも @ ルールも入れない（ADR-0025「ネストは、3つの経路で同じ意味になる書き方だけで使う」）',
  (root, _, reject) => {
    // @layer・@media・@keyframes の中にルールを置くのはネストではないので、親がルールのものだけを落とす。
    root.walk((node) => {
      if (nests(node) && node.parent?.type === 'rule') reject(node);
    });
  },
);

const declarationsBeforeNestedRules = plugin(
  'declarations-before-nested-rules',
  'ネストしたルールより後ろに宣言を書かない。後ろの宣言の扱いは、ブラウザ（CSSNestedDeclarations は Safari 18.2 から）と変換の道具で分かれる（ADR-0025「ネストは、3つの経路で同じ意味になる書き方だけで使う」）',
  (root, _, reject) => {
    root.walk((parent) => {
      if (!nests(parent) || !parent.nodes) return;
      let nested = false;
      for (const child of parent.nodes) {
        if (nests(child) && child.nodes) nested = true;
        else if (child.type === 'decl' && nested) reject(child);
      }
    });
  },
);

const noNestingUnderPseudoElement = plugin(
  'no-nesting-under-pseudo-element',
  '擬似要素（::before など）の下にネストしない。どのブラウザでも黙って効かない（ADR-0025「ネストは、3つの経路で同じ意味になる書き方だけで使う」）',
  (root, _, reject) => {
    root.walkRules((rule) => {
      // 間に @media などを挟んでも、擬似要素の下にあることは変わらないので、祖先をたどる。
      for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
        if (parent.type === 'rule' && /::[\w-]/.test(parent.selector)) return reject(rule);
      }
    });
  },
);

const disableNextLineOnly = plugin(
  'disable-next-line-only',
  '`stylelint-disable` … `stylelint-enable` で範囲を外さず、`stylelint-disable-line` も使わない。例外は、外す行の上の `stylelint-disable-next-line <ルール> -- <理由>` だけで書く。範囲で外すと、閉じ忘れたときにファイルの終わり（.astro ではほかの <style>）まで、後から足した行も黙って外れる。書き方を1つにすると、例外を grep で数えられる（ADR-0025「既知の例外は、行ごとに理由付きの disable コメントで書く」）',
  (root, _, reject) => {
    root.walkComments((comment) => {
      if (/^stylelint-(?:disable|enable|disable-line)(?:\s|$)/.test(comment.text.trim())) reject(comment);
    });
  },
);

const ROOT = new URL('../../', import.meta.url);

/** src/styles/layers.css の順の宣言に並ぶ名前。 */
const LAYER_NAMES = (() => {
  const names = [];
  postcss.parse(readFileSync(new URL('src/styles/layers.css', ROOT), 'utf8')).walkAtRules('layer', (rule) => {
    if (!rule.nodes) names.push(...rule.params.split(',').map((name) => name.trim()));
  });
  return names;
})();

const layerBy = plugin(
  'layer-by-path',
  'CSS は、置き場所で決まるレイヤーの `@layer <名前> { … }` に入れ、トップレベルにはそのブロックだけを置く。順の宣言（`@layer a, b;`）は src/styles/layers.css にだけ書き、tokens.css と @font-face のファイルには @layer を書かない。レイヤーの外に置くと順と関係なく全部に勝ち、ほかで宣言すると最初に読まれたページで順が変わる。置き場所に決まったレイヤーが無ければ、stylelint.config.mjs の overrides に足す（ADR-0025「`tokens.css` と `@font-face` のファイルはレイヤーの外、CSS Modules と `<style>` は中に置く」「順の宣言は1か所に書き、ビルドしたページで確かめる」）',
  (root, _, reject, { layers, outside = false, order = false }) => {
    if (order) {
      for (const node of root.nodes) {
        const statement = node.type === 'atrule' && node.name === 'layer' && !node.nodes;
        if (node.type !== 'comment' && !statement) reject(node);
      }
      return;
    }
    if (!outside && !layers) {
      if (root.first) reject(root.first);
      return;
    }
    root.walkAtRules('layer', (rule) => {
      const block = rule.parent === root && rule.nodes && layers?.includes(rule.params.trim()) && LAYER_NAMES.includes(rule.params.trim());
      if (outside || !block) reject(rule);
    });
    if (outside) return;
    for (const node of root.nodes) {
      if (node.type !== 'comment' && !(node.type === 'atrule' && node.name === 'layer')) reject(node);
    }
  },
);

// ページがコンポーネントの root に書いてよいもの（ADR-0025「ページは、コンポーネントの置き方だけを決める」）。
const PLACEMENT =
  /^(?:margin(?:-.+)?|position|inset(?:-.+)?|top|right|bottom|left|z-index|transform|grid-(?:column|row)(?:-.+)?|flex(?:-grow|-shrink|-basis)?|align-self|justify-self|order|width|max-width|min-height|scroll-margin(?:-.+)?)$/;

/** どれかのコンポーネント（CSS Modules）が、フォールバック付きで読む変数。受け付ける変数として、ページから書いてよい。 */
const ACCEPTED = (() => {
  const names = new Set();
  for (const dir of ['src/components/', 'src/unreleased/']) {
    for (const file of readdirSync(new URL(dir, ROOT), { recursive: true })) {
      if (!String(file).endsWith('.module.css')) continue;
      for (const { name, fallback } of varCalls(readFileSync(new URL(`${dir}${file}`.replaceAll('\\', '/'), ROOT), 'utf8'))) {
        if (fallback !== null) names.add(name);
      }
    }
  }
  return names;
})();

/** セレクタを、括弧の外の区切り（`,`）か結合子で分ける。 */
function splitTopLevel(selector, separator) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === '(') depth++;
    else if (selector[i] === ')') depth--;
    else if (depth === 0 && separator.test(selector[i])) {
      parts.push(selector.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(selector.slice(from));
  return parts.map((part) => part.trim()).filter(Boolean);
}

// ページの :global() は、子のコンポーネントに渡したクラスか id の1つだけ（下の page-global-selector）。
const COMPONENT_ROOT = /^:global\(\s*[.#][\w-]+\s*\)$/;
const inKeyframes = (rule) => rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name);
const lastCompound = (selector) => splitTopLevel(selector, /[\s>+~]/).at(-1) ?? '';

const pageGlobalSelector = plugin(
  'page-global-selector',
  'ページの :global() には、子のコンポーネントに className か id で渡したクラスか id を1つだけ書き、セレクタの最後に置く。要素名・子孫・ほかのクラスを書くと、コンポーネントの中や差し込まれる要素まで指し、どれが root かを lint が見分けられない。差し込まれる要素の見た目は、それを持つコンポーネント（XPost など）に置く（ADR-0025「ページは、コンポーネントの置き方だけを決める」）',
  (root, _, reject) => {
    root.walkRules((rule) => {
      if (inKeyframes(rule)) return;
      const bad = splitTopLevel(rule.selector, /,/).some(
        (selector) => /:global/.test(selector) && ((selector.match(/:global/g) ?? []).length > 1 || !COMPONENT_ROOT.test(lastCompound(selector))),
      );
      if (bad) reject(rule);
    });
  },
);

const pagePlacesComponents = plugin(
  'page-places-components',
  'ページから子のコンポーネントの root（`:global(.x)`）に書いてよいのは、置き方（margin・position・inset・top などの位置・z-index・transform・grid-column・grid-row・flex・align-self・justify-self・order・width・max-width・min-height・scroll-margin）と、コンポーネントがフォールバック付きで読む変数だけ。色・枠・文字・padding・display・gap は、コンポーネントの中か props に置く（ADR-0025「ページは、コンポーネントの置き方だけを決める」）',
  (root, _, reject) => {
    root.walkRules((rule) => {
      if (inKeyframes(rule) || !splitTopLevel(rule.selector, /,/).some((selector) => COMPONENT_ROOT.test(lastCompound(selector)))) return;
      for (const node of rule.nodes) {
        if (node.type === 'decl' && !(PLACEMENT.test(node.prop) || ACCEPTED.has(node.prop))) reject(node);
      }
    });
  },
);

// トークンは src/styles/tokens.css が :root に書いたもの。設定の referenceFiles で読ませる。
function tokenNames(result) {
  const names = new Set();
  for (const ref of result.stylelint.referenceRoots ?? []) ref.walkDecls(/^--/, (decl) => names.add(decl.prop));
  return names;
}
/** 値の中の `var(--名前, フォールバック)` を、入れ子の括弧を数えて取り出す。フォールバックが無ければ `fallback` は null。 */
function* varCalls(value) {
  for (const m of value.matchAll(/\bvar\(\s*(--[\w-]+)\s*/gi)) {
    let i = m.index + m[0].length;
    if (value[i] !== ',') {
      yield { name: m[1], fallback: null };
      continue;
    }
    const from = ++i;
    for (let depth = 0; i < value.length && (depth > 0 || value[i] !== ')'); i++) {
      if (value[i] === '(') depth++;
      if (value[i] === ')') depth--;
    }
    yield { name: m[1], fallback: value.slice(from, i).trim() };
  }
}
// 単位の付いた 0（0deg・0px など）も 0 として通す。
const ZERO = /^0(?:[a-z%]+)?$/i;
const KEYWORDS = new Set(['none', 'auto', 'initial', 'inherit', 'unset', 'transparent', 'currentcolor', 'normal']);

const customPropertyFallback = plugin(
  'custom-property-fallback',
  'トークンはフォールバックを付けずに読み、コンポーネントが受け付ける変数のフォールバックは、トークン・キーワード（none など）・0 のどれかにする。トークンに付けると、名前を打ち間違えても黙ってフォールバックで描く（ADR-0025「カスタムプロパティは、フォールバックの有無で役を分ける」）',
  (root, result, reject) => {
    const tokens = tokenNames(result);
    root.walkDecls((decl) => {
      for (const { name, fallback } of varCalls(decl.value)) {
        if (fallback === null) continue;
        const token = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(fallback)?.[1];
        const ok = !tokens.has(name) && (KEYWORDS.has(fallback.toLowerCase()) || ZERO.test(fallback) || (token !== undefined && tokens.has(token)));
        if (!ok) reject(decl);
      }
    });
  },
);

const SPACING = /^(?:gap|row-gap|column-gap|padding(?:-.+)?|margin(?:-.+)?|scroll-margin(?:-.+)?|scroll-padding(?:-.+)?)$/;
/** 値から `var(…)` を除いた残り。トークンを読んだ所は見ないため。 */
function withoutVar(value) {
  let out = '';
  for (let i = 0, depth = 0; i < value.length; i++) {
    if (depth === 0 && value.startsWith('var(', i)) {
      depth = 1;
      i += 3;
    } else if (depth > 0) {
      if (value[i] === '(') depth++;
      if (value[i] === ')') depth--;
    } else {
      out += value[i];
    }
  }
  return out;
}
// 前が数字・英字・`.`・`-` でない rem・px の数。負の値（`-1rem`）と 0 は、余白の段に入れないので見ない。
const LENGTH = /(?<![\w.-])(\d*\.?\d+)(?:rem|px)\b/g;

const SPACE = /^--space-\d+$/;

const spaceToken = plugin(
  'space-token',
  '余白（gap・padding・margin・scroll-margin・scroll-padding）は var(--space-N) で書く（値が var(--space-N) のトークンも読める）。rem・px を直に書いたり、余白でないトークン（--radius-* など）を読んだりすると、4px 刻みの段から外れた値が黙って入る。0・auto・em・負の値・vw・% はトークンにしない（ADR-0025「余白は 4px 刻みのトークンにし、切り上げて丸める」）',
  (root, result, reject) => {
    const tokens = new Map();
    for (const ref of result.stylelint.referenceRoots ?? []) ref.walkDecls(/^--/, (decl) => tokens.set(decl.prop, decl.value.trim()));
    // tokens.css に無い名前（コンポーネントの中の変数）は、ここでは見ない。
    const spacing = (name) => !tokens.has(name) || SPACE.test(name) || SPACE.test(/^var\(\s*(--[\w-]+)\s*\)$/.exec(tokens.get(name))?.[1] ?? '');
    root.walkDecls(SPACING, (decl) => {
      const literal = [...withoutVar(decl.value).matchAll(LENGTH)].some(([, n]) => Number(n) !== 0);
      if (literal || [...varCalls(decl.value)].some(({ name }) => !spacing(name))) reject(decl);
    });
  },
);

const spaceTokenScale = plugin(
  'space-token-scale',
  '--space-N の値は N × 0.25rem（4px 刻み）にする。名前の N と値が食い違うと、名前から大きさを読めなくなる（ADR-0025「余白は 4px 刻みのトークンにし、切り上げて丸める」）',
  (root, _, reject) => {
    root.walkDecls(/^--space-/, (decl) => {
      const n = /^--space-(\d+)$/.exec(decl.prop)?.[1];
      if (n === undefined || decl.value.trim() !== `${Number(n) * 0.25}rem`) reject(decl);
    });
  },
);

export default [
  declarationsBeforeNestedRules,
  noNesting,
  noNestingUnderPseudoElement,
  disableNextLineOnly,
  layerBy,
  pageGlobalSelector,
  pagePlacesComponents,
  customPropertyFallback,
  spaceToken,
  spaceTokenScale,
];
