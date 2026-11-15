/**
 * 配信スケジュールの更新の通知を、この端末で受け取れるか・受け取っているかの判断（ADR-0035 の決定）。
 * ブラウザから読んだ値を受け取るだけにし、src/components/notify-subscription.ts が使う。
 */

/** `Notification.permission` の値。DOM の型に頼らず、ここで書く。 */
export type NotifyPermission = "default" | "denied" | "granted";

/** iPhone・iPad か。iPadOS の Safari は Mac と名乗るので、触れる画面かどうかで見分ける。 */
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/**
 * 購読を試せるか。iOS では、ホーム画面に追加したアプリでしか購読できない（Apple の資料「Sending web push notifications
 * in web apps and browsers」）。Safari のタブに通知の API があっても購読を試させないよう、API があるかより先に分ける。
 */
export function notifyAvailability(device: {
  appleMobile: boolean;
  standalone: boolean;
  supported: boolean;
}): "available" | "ios" | "unsupported" {
  if (device.appleMobile && !device.standalone) return "ios";
  return device.supported ? "available" : "unsupported";
}

/**
 * 受け取っているか。購読が残っていても、通知が許可されていなければ届かないので、受け取っているとは言わない。
 * 許可を聞く画面を閉じただけ（`default`）なら、もう一度押せば聞き直せるので、拒んだ（`denied`）とは分ける。
 */
export function subscriptionStatus(
  subscribed: boolean,
  permission: NotifyPermission,
): "on" | "off" | "denied" {
  if (permission === "denied") return "denied";
  return subscribed && permission === "granted" ? "on" : "off";
}
