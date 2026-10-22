import { defineConfig } from 'vitest/config';

// 単体テスト（tests/unit）とリポジトリの検査（tests/repo）の層。Astro には一切依存させない（→ docs/adr/0003-testing-and-ci.md）。
// getViteConfig(astro) を噛ませると、ビルドが壊れたときに単体テストまで一緒に赤くなる。
export default defineConfig({
  resolve: {
    // tsconfig.json の paths（エイリアス `@site-assets` など）を Vite にそのまま読ませる。
    // Astro を通さないので、ここで読ませないと単体テストからコンポーネントを import したときに解決できない。
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      { extends: true, test: { name: 'repo', include: ['tests/repo/**/*.test.ts'] } },
    ],
  },
});
