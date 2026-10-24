# 開発サーバーとブラウザ

出どころ: rurino-nemo-fansite#140・rurino-nemo-fansite#141

- **作業を終えたら、開発サーバーを `pnpm astro dev stop` で止め、ブラウザ（Playwright MCP は `browser_close`）を閉じる。** 止め忘れたサーバーとブラウザが worktree やセッションごとに溜まり、メモリを圧迫したため。ページを開いたままだと、使われていないサーバーを止める仕組み（`src/integrations/dev-idle.ts` のコメント）も効かない。見直す条件: Playwright MCP が、使い終えたブラウザを自分で閉じるようになったら
