/**
 * 配信スケジュールの更新の通知の購読を、確かめる・始める・やめる（ADR-0035 の決定）。トップのスイッチ
 * （src/unreleased/_parts/ScheduleNotify.astro）のスクリプトが使う。ブラウザの API と fetch に触るので、src/lib には置かない。
 *
 * 購読の API と Service Worker は Worker が返すので、`pnpm dev` では設定できない（`wrangler dev` で見る）。
 * Service Worker は購読を始めたときだけ登録し、やめたら外す（ADR-0035「Service Worker は、押した人にだけ登録し、
 * push だけを受け持つ」）。開いただけでは `getRegistration()` で確かめるだけにする。
 */
import { SERVICE_WORKER_PATH, SUBSCRIPTIONS_PATH, VAPID_PUBLIC_KEY } from "../data/notify";
import { isAppleMobile, notifyAvailability, subscriptionStatus } from "../lib/notify-status";
import { fromBase64url } from "../lib/web-push";

/** 受け取っているか。`denied` は、通知を拒んでいて、押しても聞き直せないとき。 */
export type NotifyStatus = ReturnType<typeof subscriptionStatus>;

/** この端末で購読を試せるか（`ios` は、iPhone・iPad の Safari のタブ）。 */
export function availability(): ReturnType<typeof notifyAvailability> {
  return notifyAvailability({
    appleMobile: isAppleMobile(navigator.userAgent, navigator.maxTouchPoints),
    standalone: matchMedia("(display-mode: standalone)").matches,
    supported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
  });
}

export async function readStatus(): Promise<NotifyStatus> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscriptionStatus(Boolean(subscription), Notification.permission);
}

const send = async (method: "POST" | "DELETE", endpoint: string) => {
  const response = await fetch(SUBSCRIPTIONS_PATH, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) throw new Error(`${method} ${response.status}`);
};

/**
 * 登録した Service Worker が動き出すのを待つ。`navigator.serviceWorker.ready` は使わない。同じページで一度外して
 * 登録し直すと、外した古い登録を返し続け、購読が「no active Service Worker」で落ちるため（2026-11-14 に Chromium で確かめた）。
 */
const activated = (registration: ServiceWorkerRegistration) =>
  new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const worker = registration.installing ?? registration.waiting;
    if (registration.active || !worker) return resolve(registration);
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") resolve(registration);
      if (worker.state === "redundant") reject(new Error("Service Worker を入れられなかった"));
    });
  });

/** 呼ぶ側は、押した操作の中で、await を挟まずにここを呼ぶ（下の requestPermission のため）。 */
export async function subscribe(): Promise<NotifyStatus> {
  // iOS は、押した操作の中でしか許可を求めさせないので、ほかの処理より先に呼ぶ。
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return subscriptionStatus(false, permission);
  const registered = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
  let subscription: PushSubscription | undefined;
  try {
    const active = await activated(registered);
    subscription = await active.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromBase64url(VAPID_PUBLIC_KEY),
    });
    await send("POST", subscription.endpoint);
  } catch (error) {
    // 宛先を覚えてもらえないまま、購読と Service Worker を残さない。届かないのに「受け取る設定」に見え、
    // 押していないのと同じ人の端末に、Service Worker が残るため（ADR-0035「押した人にだけ登録し」）。
    await subscription?.unsubscribe();
    await registered.unregister();
    throw error;
  }
  return "on";
}

export async function unsubscribe(): Promise<NotifyStatus> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  // 先に Worker から消す。消せなかったら購読を残し、届き続けるのに「やめた」に見えないようにする。
  if (subscription) await send("DELETE", subscription.endpoint);
  await subscription?.unsubscribe();
  await registration?.unregister();
  return subscriptionStatus(false, Notification.permission);
}
