/**
 * 配信スケジュールの更新の通知（docs/adr/0035-schedule-push-notifications.md）で、ページと Worker（worker/notify.ts）が
 * 同じ値を読むもの。
 */

/** 通知を受け取る設定をするページ。Worker は、このページがあるビルドでだけ購読を受け付ける（ADR-0035 の決定）。 */
export const NOTIFY_PAGE = "/notify/";

/** 購読を足す（POST）・消す（DELETE）パス。本文は `{ "endpoint": "<宛先の URL>" }`。 */
export const SUBSCRIPTIONS_PATH = "/notify/subscriptions";

/**
 * VAPID の公開鍵（圧縮していない P-256 の点を base64url にしたもの）。対になる秘密鍵は Worker のシークレット
 * `VAPID_PRIVATE_KEY` にある。替えると今の購読には送れなくなるので、作り直すのは秘密鍵を失くしたときだけにする
 * （ADR-0035「払うもの」）。作り方は scripts/vapid-keys.mjs。
 */
export const VAPID_PUBLIC_KEY =
  "BLRZwTKRj9LCWnOo5Ko5uJsPj_Izxp5o9o-VzI5pkOCfLegBtVrHmLdEBE0nQo7n_fH_GHQ2QLoOnJ4G1eSD-CE";

/** VAPID の JWT の `sub`（送り手の連絡先）。Apple は URL か `mailto:` しか受け付けない。問い合わせの窓口のあるページを指す。 */
export const VAPID_SUBJECT = "https://rrnnm.fans/about/";
