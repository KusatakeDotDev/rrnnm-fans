import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroIntegration, ViteUserConfig } from 'astro';

import { isInside, parseShowUnreleased, unreleasedRoute } from '../lib/unreleased.ts';

type VitePlugin = Extract<NonNullable<ViteUserConfig['plugins']>[number], { name: string }>;

const EMPTY = fileURLToPath(new URL('./Empty.astro', import.meta.url));
const LIB = fileURLToPath(new URL('../lib/unreleased.ts', import.meta.url));

function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

/** 描かなくても import していれば CSS がページに出るため（ADR-0018「今あるページに足す区画は、コンポーネントにして import ごと差し替える」）。 */
function emptyImports(dir: string): VitePlugin {
  return {
    name: 'unreleased-empty-imports',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // src/unreleased/ を指すエイリアスは無いので、外から入る import は相対パスに unreleased を含む。
      // ほかの import まで解決し直さないよう、先に絞る。
      if (!importer || !source.includes('unreleased') || isInside(dir, importer)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && isInside(dir, resolved.id) ? EMPTY : null;
    },
  };
}

/** ADR-0018 の決定。 */
export default function unreleased(): AstroIntegration {
  return {
    name: 'unreleased',
    hooks: {
      'astro:config:setup': ({ command, config, injectRoute, updateConfig, logger }) => {
        const show = parseShowUnreleased(process.env['SHOW_UNRELEASED'], command);
        const dir = fileURLToPath(new URL('unreleased/', config.srcDir));
        const pages = (existsSync(dir) ? filesIn(dir) : []).flatMap((file) => {
          const pattern = unreleasedRoute(file);
          return pattern === null ? [] : [{ pattern, entrypoint: path.join(dir, file) }];
        });
        // 同じ判定とルート一覧をAstro側のリンク選択へ渡す。Reactは選択済みpropsだけを受け取る。
        const moduleId = 'virtual:site-routes';
        updateConfig({ vite: { plugins: [{
          name: 'unreleased-site-routes',
          resolveId(id) { return id === moduleId ? `\0${moduleId}` : null; },
          load(id) {
            if (id !== `\0${moduleId}`) return null;
            return `import { isRouteVisible as visible } from ${JSON.stringify(LIB)};
              const hidden = ${JSON.stringify(show ? [] : pages.map((page) => page.pattern))};
              export function isRouteVisible(href) { return visible(href, hidden); }`;
          },
        }] } });
        if (show) {
          for (const page of pages) injectRoute(page);
        } else {
          updateConfig({ vite: { plugins: [emptyImports(dir)] } });
        }
        logger.info(`未公開のページ ${pages.length} 件と、外から import したコンポーネントを${show ? '出す' : '出さない'}`);
      },
    },
  };
}
