---
paths:
  - "package.json"
  - "pnpm-workspace.yaml"
  - ".github/workflows/**"
  - ".github/actions/**"
---

# 依存のバージョンと説明の書き方

依存やワークフローのアクション（`uses:`）を足す・替える・バージョンを変えるときは、先に `.github/instructions/dependencies.instructions.md` を Read で読み、それに従う。Copilot のコードレビューと同じ1つのファイルを読むため（Claude Code は `paths:` 付きの rule の中の `@import` を展開しない）。
