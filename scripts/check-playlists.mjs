/**
 * トップのタイルに出す再生リスト（src/data/playlists.ts）が、本家にまだあるかを確かめる。
 *
 * docs/adr/0008-playlist-carousel.md「名前と表紙は、ブラウザで取る」の「払うもの」/ docs/OPERATIONS.md §6。
 * .github/workflows/playlists-check.yml が週1回と、playlists.ts を変えた PR で回す。
 * 手元では `pnpm playlists:check`。
 *
 * 名前と表紙はブラウザで取るので、再生リストが消えてもビルドも規約テストも落ちない。
 * それを補う**監視**で、コードの仕様のテストではない。だから tests/ に置かず、ci-ok にも入れない。
 *
 * **判定は2つに分ける。** どちらも1件でもあれば非0で終わる（監視なので黙らない）が、
 * 次にやることが違うので言い分ける。
 *   - 見つからない … 404（無い再生リストで返ることを 2026-09-14 に確認）。非公開の再生リストで
 *     何が返るかは確かめていないので、401・403 もこちらに数える。playlists.ts を見直す
 *   - 確かめられなかった … それ以外（429・5xx・通信断）。YouTube 側の一時的な不調の可能性があるので、
 *     時間をおいて再実行する
 *
 * **1件ずつ順に問い合わせる。** 11件を同時に投げると、まとめて制限（429）に掛かったときに
 * 取り直しもまた同時になり、同じ制限に掛かる。週1回の監視なので、順に回す数秒の差は問題にならない。
 * 200 以外だったときは5秒待って1回だけ取り直す。
 */
import { PLAYLISTS, playlistUrl } from "../src/data/playlists.ts";
import { oembedUrl } from "../src/lib/youtube.ts";

// YouTube 側が詰まっても、ワークフローの timeout-minutes より先に諦める。
const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 5_000;

/** 本家で見つからない、とみなすステータス。 */
const GONE = new Set([401, 403, 404]);

/** oEmbed の HTTP ステータス。通信そのものが失敗したら、その理由の文字列。 */
async function fetchStatus(url) {
  try {
    const res = await fetch(oembedUrl(url), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.status;
  } catch (error) {
    return `通信失敗: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function check({ id, label }) {
  const url = playlistUrl(id);
  let status = await fetchStatus(url);
  if (status !== 200) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    status = await fetchStatus(url);
  }
  return { label, url, status };
}

const results = [];
for (const playlist of PLAYLISTS) {
  results.push(await check(playlist));
}

const gone = results.filter((r) => GONE.has(r.status));
const unknown = results.filter((r) => r.status !== 200 && !GONE.has(r.status));

for (const { label, url, status } of results) {
  const mark = status === 200 ? "ok" : GONE.has(status) ? "NG" : "??";
  console.log(`${mark}  ${status}  ${label}  ${url}`);
}

// GitHub Actions では注釈として実行のまとめに出る。ログを開かなくても、どれが何だったか分かる。
if (process.env["GITHUB_ACTIONS"]) {
  for (const { label, url, status } of gone) {
    console.log(`::error title=本家で見つからない再生リスト::${label} ${url}（${status}）`);
  }
  for (const { label, url, status } of unknown) {
    console.log(`::warning title=確かめられなかった再生リスト::${label} ${url}（${status}）`);
  }
}

if (gone.length > 0) {
  console.error(
    `\n本家で見つからない再生リストが ${gone.length} 件ある。src/data/playlists.ts から外すか差し替える。`,
  );
}
if (unknown.length > 0) {
  console.error(
    `\n確かめられなかった再生リストが ${unknown.length} 件ある。YouTube 側の一時的な不調の可能性があるので、時間をおいて再実行する。`,
  );
}
if (gone.length > 0 || unknown.length > 0) {
  process.exit(1);
}

console.log(`\n${results.length} 件すべて本家にある。`);
