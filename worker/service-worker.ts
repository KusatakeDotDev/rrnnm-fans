/**
 * 配信スケジュールの更新の通知を受ける Service Worker（ADR-0035「Service Worker は、押した人にだけ登録し、push だけを受け持つ」）。
 * 設定のページ（`/notify/`）で「通知を受け取る」を押したときだけ登録される。
 *
 * **Worker が、決まったパス（SERVICE_WORKER_PATH）で返す。** ビルドが名前にフィンガープリントを付けると、Release のたびに
 * パスが変わり、ブラウザが登録したパスを取り直すと 404 になる。静的なファイル（`public/`）に置くと、設定のページが
 * 無いビルドでも配られる（ADR-0018）。中身を文字列で持つのは、ScheduleCard.tsx の LOAD_THUMBNAIL と同じく、ブラウザで
 * そのまま動かすため（Worker のバンドルは、関数の中に名前を残すための呼び出しを差し込む）。
 */
import { NOTIFICATION_BODY, NOTIFICATION_TITLE, NOTIFICATION_URL } from "../src/data/notify";

/**
 * - push は中身が無いので、決まった文を出す。Safari は、push を受けて通知を出さないと、通知の許可を取り消すので、
 *   いつも出す（ADR-0035「push に中身を持たせない」）
 * - `tag` を同じにして、まだ見ていない通知があれば置き換える。週に1回の知らせを、溜めて並べないため。`renotify` を付けるのは、
 *   付けないと置き換えが音も振動も無く行われ、同じ文なので、新しく更新されたことに気づけないため
 * - `fetch` は受けない。ページの配り方を変えないため
 * - 新しいバージョンは、待たずに入れ替える（skipWaiting）。ページのリクエストを受けないので、入れ替えても開いているページは変わらない
 */
export const SERVICE_WORKER_SOURCE = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('push', (event) => {
  event.waitUntil(self.registration.showNotification(${JSON.stringify(NOTIFICATION_TITLE)}, {
    body: ${JSON.stringify(NOTIFICATION_BODY)},
    icon: '/favicon-192.png',
    lang: 'ja',
    tag: 'schedule',
    renotify: true,
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(${JSON.stringify(NOTIFICATION_URL)}));
});
`;

export function serviceWorkerResponse(): Response {
  return new Response(SERVICE_WORKER_SOURCE, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      // 中身は Release で替わるので、古いものを覚えさせたままにしない。
      "cache-control": "no-cache",
    },
  });
}
