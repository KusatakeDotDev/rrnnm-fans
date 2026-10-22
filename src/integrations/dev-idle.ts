import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import type { AstroIntegration, ViteUserConfig } from 'astro';

import { devIdleReason, isOwnLockFile, parseIdleMinutes, sleptSince } from '../lib/dev-idle.ts';

type VitePlugin = Extract<NonNullable<ViteUserConfig['plugins']>[number], { name: string }>;

/**
 * 使われていないかを見る間隔。止まる時刻は、決まりの長さからこの分だけ前後しうる — 見回りのときにしか見ないので、
 * 止まるのは最大この分だけ遅れ、タブを閉じた時刻は最大この分だけ前の見回りの時刻になる（止まるのが早まる）。
 */
const DEV_IDLE_CHECK_MS = 30_000;
/** 開発サーバーを閉じる処理が戻らないとき、待たずにプロセスを終えるまで。 */
const DEV_IDLE_CLOSE_TIMEOUT_MS = 10_000;

/**
 * Astro が書いた開発サーバーの lockfile（`.astro/dev.json`）が、このプロセスのものなら消す。
 * 置き場所と中身は Astro のもの（core/dev/lockfile.js）。読めない・形が違う・別の pid なら、何もしない。
 * Astro が lockfile を書く場所は、CLI の `--root` か作業ディレクトリで、設定の `root` ではない
 * （cli/dev/index.js）。どちらで立てても拾えるよう、作業ディレクトリと設定の `root` の両方を見る。
 */
function removeOwnLockFile(root: string): void {
  for (const dir of new Set([process.cwd(), root])) {
    const file = join(dir, '.astro', 'dev.json');
    try {
      if (isOwnLockFile(readFileSync(file, 'utf-8'), process.pid)) unlinkSync(file);
    } catch {
      // 無い・読めないなら、消すものは無い。
    }
  }
}

/** 決まりの1行を最後に出した文言。設定を保存して開発サーバーが作り直されるたびに、同じ1行を出し直さない。 */
const ANNOUNCED = Symbol.for('rrnnm.dev-idle-shutdown.announced');

/*
 * 使われていない開発サーバーを止める（`pnpm dev` のときだけ。ビルドには効かない）。
 * 止め忘れた開発サーバーが worktree ごとに溜まって、メモリを圧迫するため。決まりは src/lib/dev-idle.ts。
 * - 誰も使っていない（ページを開いているブラウザも、リクエストも無い）まま DEV_IDLE_MINUTES 分（既定 10）
 * - ページを開いたままでも、リクエストが無いまま DEV_IDLE_MAX_MINUTES 分（既定 60）
 * どちらも 0 で止めない。
 *
 * Vite のページは、同じポートで立て直したサーバーにもつなぎ直す（開いたままなら、立て直したサーバーも
 * 1つめの決まりでは止まらない）。
 *
 * 止めた理由は、`無かったので、開発サーバーを止める` を含む `[dev-idle]` の1行に出す（立ち上げたときの1行とは
 * 別）。Astro がバックグラウンドに回さなかったときは、`pnpm dev` を打った出力に出る（Windows で `pnpm dev` を
 * 止めたあとに残った astro が止まったときは、読めないことがある）。エージェントが打ったと見分けた `pnpm dev` は、Windows 以外では Astro がバックグラウンドに
 * 回すので、その行は `.astro/dev.log` にだけ残る（止まったあとは `astro dev logs` では見えない。
 * バックグラウンドで立て直すと、ログは消える）。理由を確かめたいときは、立て直す前に読む。
 *
 * 止めるときは、開発サーバーを閉じてからプロセスごと終える（Windows では pnpm を止めても astro が残るため）。
 * Astro の終わり方は通らないので、Astro が書いた `.astro/dev.json`（動いている開発サーバーの pid）は自分で消す。
 * 残すと、あとで打った `astro dev stop` が、その pid を使い回した別のプロセスを止めかねない（コマンドラインを
 * 読めないプロセスは astro とみなすため）。消すのは、中の pid が自分のときだけ。Astro がこの置き方を変えたら、
 * 何もしない（次の `astro dev` が、動いていないものとして消す）。
 *
 * 長さは performance.now() で測る。Date.now() だと、時計を合わせ直したときに長さが狂う。
 */
function devIdleShutdown(): VitePlugin {
  return {
    name: 'dev-idle-shutdown',
    apply: 'serve',
    configureServer(server) {
      // ポートを開く開発サーバーにだけ効かせる。astro check などが中で作る、ポートを開かないサーバーは除く。
      const httpServer = server.httpServer;
      if (!httpServer) return;
      const limits = {
        idleMs: parseIdleMinutes(process.env['DEV_IDLE_MINUTES'], 10),
        maxMs: parseIdleMinutes(process.env['DEV_IDLE_MAX_MINUTES'], 60),
      };
      if (limits.idleMs === Infinity && limits.maxMs === Infinity) return;
      const { logger, root } = server.config;
      // HMR を切った設定では、ページを開いているブラウザを数えられない（Vite は空の一覧を返す）。
      const hmrOff = server.config.server.ws === false;
      const minutes = (ms: number) => `${ms / 60_000} 分`;

      const watch = () => {
        const rules = [
          limits.idleMs !== Infinity && `誰も使わないまま ${minutes(limits.idleMs)}`,
          limits.maxMs !== Infinity && `リクエストが無いまま ${minutes(limits.maxMs)}`,
        ].filter(Boolean);
        const announcement =
          `[dev-idle] ${rules.join('、または')}たつと、開発サーバーを止める` +
          '（DEV_IDLE_MINUTES・DEV_IDLE_MAX_MINUTES で変えられる。0 で止めない）';
        // 設定を読み直すとこのプラグインは作り直され、Astro が設定を Vite で読んだときはこのファイルも読み直されるので、
        // 覚えておく場所は globalThis にする。
        const memory = globalThis as unknown as Record<symbol, unknown>;
        if (memory[ANNOUNCED] !== announcement) {
          logger.info(announcement);
          memory[ANNOUNCED] = announcement;
        }

        const startedAt = performance.now();
        let lastCheckAt = startedAt;
        let lastRequestAt = startedAt;
        let lastBrowserAt = startedAt;
        // middleware ではなく HTTP サーバーで数える。手前で応答を返す middleware（404・リダイレクトなど）も拾える。
        httpServer.on('request', () => {
          lastRequestAt = performance.now();
        });
        const timer = setInterval(() => {
          const now = performance.now();
          if (sleptSince(lastCheckAt, now, DEV_IDLE_CHECK_MS)) {
            lastRequestAt = now;
            lastBrowserAt = now;
          }
          lastCheckAt = now;
          // ページを開いているブラウザは、Vite の HMR につながっている。数えられないときは null。
          const clients: unknown = server.ws?.clients;
          const browsers = !hmrOff && clients instanceof Set ? clients.size : null;
          if (browsers) lastBrowserAt = now;
          const reason = devIdleReason({ now, browsers, lastBrowserAt, lastRequestAt }, limits);
          if (!reason) return;
          clearInterval(timer);
          logger.info(
            reason === 'idle'
              ? `[dev-idle] ${minutes(limits.idleMs)}のあいだ、ページを開いているブラウザもリクエストも無かったので、開発サーバーを止める`
              : `[dev-idle] ${minutes(limits.maxMs)}のあいだリクエストが無かったので、開発サーバーを止める` +
                  (browsers ? '（ページは開いたまま）' : ''),
          );
          const exit = (code: number) => {
            removeOwnLockFile(root);
            process.exit(code);
          };
          // 閉じる処理が戻らなくても、抜け殻のプロセスを残さないよう、待ちすぎたら終える。
          setTimeout(() => {
            logger.error(`[dev-idle] 開発サーバーを閉じる処理が ${DEV_IDLE_CLOSE_TIMEOUT_MS / 1000} 秒で終わらなかったので、待たずに終える`);
            exit(1);
          }, DEV_IDLE_CLOSE_TIMEOUT_MS);
          server.close().then(
            () => exit(0),
            (error: unknown) => {
              logger.error(`[dev-idle] 開発サーバーを閉じられなかった: ${String(error)}`);
              exit(1);
            },
          );
        }, DEV_IDLE_CHECK_MS);
        // 監視のせいでプロセスが終わらない、ということが無いようにする。
        timer.unref();
        // 設定を変えて Astro が開発サーバーを作り直したときは、古いほうの監視を外す。
        // 作り直しで新しいサーバーがポートを開けなかったとき（古いほうはもう閉じている）は、どちらの監視も
        // 動かず、プロセスが残る。ポートは閉じた直後に空くのでめったに起きず、拾うにはサーバーの間で監視を
        // 受け渡す仕組みが要るので、拾わない。
        httpServer.once('close', () => clearInterval(timer));
      };
      // 監視は、ポートを開いてから始める。Vite はサーバーを作り直すとき、ポートを開く前にここを呼ぶ。
      // 作り直しが途中で失敗すると、そのサーバーはポートを開かないまま捨てられ、閉じる知らせも来ない。
      // 先に監視を始めると、使っている古いサーバーのプロセスまで、あとで終えてしまう。
      if (httpServer.listening) watch();
      else httpServer.once('listening', watch);
    },
  };
}

export default function devIdle(): AstroIntegration {
  return {
    name: 'dev-idle',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({ vite: { plugins: [devIdleShutdown()] } });
      },
    },
  };
}
