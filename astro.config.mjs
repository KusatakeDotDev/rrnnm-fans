// @ts-check

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// 設定を読み直しても、ここから読む src/integrations/dev-idle.ts と、その先の src/lib/dev-idle.ts は前のものが残る
// （Node が覚えている）。どちらかを変えたら、開発サーバーを立て直して確かめる。
import devIdle from "./src/integrations/dev-idle.ts";
import unreleased from "./src/integrations/unreleased.ts";
import { cssTarget } from "./src/styles/browser-targets.mjs";

// https://astro.build/config
export default defineConfig({
  site: "https://rrnnm.fans",
  // サイトマップに `lastmod`・`changefreq`・`priority` は付けない。Google は `changefreq` と `priority` を読まず、`lastmod` は
  // 正確なときしか使わないが、このサイトはページごとの更新日を持っていないため（ファイルのコミット日は、ページの中身と合わない）。
  integrations: [react(), sitemap(), unreleased(), devIdle()],
  // スコープは属性ではなくクラスで付ける。React のコンポーネントに渡る class はレンダラが捨てるので、
  // 親のスコープ付き CSS がコンポーネントの root に届かない（ADR-0011「スコープをクラスで付ける」）。
  scopedStyleStrategy: "class",
  vite: {
    build: {
      // ADR-0025「ブラウザの下限は1か所に書き、サイトと Storybook に同じ値を渡す」。
      cssTarget,
      // webfont のチャンクは、小さくても CSS に埋め込まない。埋め込むと、ページの字に当たらないチャンクまで、
      // @font-face の CSS と一緒に全ページで読む（src/styles/fonts.css）。
      assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
    },
    css: {
      postcss: {
        plugins: [
          {
            // @font-face の src から woff を外す。woff2 を読めるブラウザは woff を取りに行かず、dist と CSS が重くなるだけのため。
            // Vite は CSS の @import を、ほかのプラグインの transform を通さずに中へ展開するので、展開した後に効く PostCSS で外す。
            // url() を解決する前に外れるので、woff はビルドに出ない。
            postcssPlugin: "drop-woff-sources",
            AtRule: {
              "font-face": (rule) => {
                rule.walkDecls("src", (decl) => {
                  const sources = decl.value.split(/,(?![^(]*\))/);
                  const kept = sources.filter(
                    (source) => !/format\(\s*['"]?woff['"]?\s*\)/i.test(source),
                  );
                  if (kept.length > 0 && kept.length < sources.length)
                    decl.value = kept.join(",").trim();
                });
              },
            },
          },
        ],
      },
    },
  },
});
