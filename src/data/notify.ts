/**
 * 配信スケジュールの更新の通知（docs/adr/0035-schedule-push-notifications.md）で、ページと Worker（worker/notify.ts）が
 * 同じ値を読むもの。
 */

/** 通知を受け取る設定をするページ。Worker は、このページがあるビルドでだけ購読を受け付ける（ADR-0035 の決定）。 */
export const NOTIFY_PAGE = "/notify/";

/** 購読を足す（POST）・消す（DELETE）パス。本文は `{ "endpoint": "<宛先の URL>" }`。 */
export const SUBSCRIPTIONS_PATH = "/notify/subscriptions";

/**
 * Service Worker のパス。Worker が返す（worker/service-worker.ts）。置いた場所でスコープが `/notify/` になるが、push と、
 * 通知を押したときは、スコープの外のページも開けるので、そのままにする。
 */
export const SERVICE_WORKER_PATH = "/notify/sw.js";

/**
 * 通知の文（主の判断）。本文は、ご本人のスケジュールのお知らせの決まり文句に、妖精（🧚）が応える形にする。ご本人の口調にはしない
 * （docs/CONCEPT.md §2「一人称で本人が喋る文体を使わない」）。ご本人は女性の妖精（🧚‍♀️）を使うので、ご本人と読まれないよう、
 * 性別の無い 🧚 にする。非公式の断り書きは、本文に足さない（主の判断）。
 */
export const NOTIFICATION_TITLE = "配信スケジュール更新";
export const NOTIFICATION_BODY = "🧚< スケジュールいっちょう入りました！";

/** 通知を押したときに開くページ。トップの今週の配信予定。 */
export const NOTIFICATION_URL = "/#schedule";

/**
 * VAPID の公開鍵（圧縮していない P-256 の点を base64url にしたもの）。対になる秘密鍵は Worker のシークレット
 * `VAPID_PRIVATE_KEY` にある。替えると今の購読には送れなくなるので、作り直すのは秘密鍵を失くしたときだけにする
 * （ADR-0035「払うもの」）。作り方は scripts/vapid-keys.mjs。
 */
export const VAPID_PUBLIC_KEY =
  "BLRZwTKRj9LCWnOo5Ko5uJsPj_Izxp5o9o-VzI5pkOCfLegBtVrHmLdEBE0nQo7n_fH_GHQ2QLoOnJ4G1eSD-CE";

/** VAPID の JWT の `sub`（送り手の連絡先）。Apple は URL か `mailto:` しか受け付けない。問い合わせの窓口のあるページを指す。 */
export const VAPID_SUBJECT = "https://rrnnm.fans/about/";
