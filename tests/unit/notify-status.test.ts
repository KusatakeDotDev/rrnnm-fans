import { describe, expect, it } from "vite-plus/test";

import { isAppleMobile, notifyAvailability, subscriptionStatus } from "../../src/lib/notify-status";

/**
 * src/lib/notify-status.ts — 通知を受け取れるか・受け取っているかの判断（docs/adr/0035-schedule-push-notifications.md）。
 * 壊れると「iPhone の Safari のタブで、通らない購読を試させる」「受け取れないのに ON に見える」「拒んだ人に、押せば
 * 聞き直せるように見せる」の形で出る。
 */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const IPAD_OLD =
  "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1";
const IPOD =
  "Mozilla/5.0 (iPod touch; CPU iPhone OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

describe("iPhone・iPad の見分け", () => {
  it.each([
    ["iPhone", IPHONE, 5],
    ["iPadOS 12 までの iPad", IPAD_OLD, 5],
    ["iPod touch", IPOD, 5],
    ["Mac と名乗る iPadOS の iPad（触れる画面）", MAC, 5],
    ["指を2本まで数える触れる画面の Mac", MAC, 2],
  ])("%s は iPhone・iPad に数える", (_, userAgent, touchPoints) => {
    expect(isAppleMobile(userAgent, touchPoints)).toBe(true);
  });

  it.each([
    ["触れる画面の無い Mac", MAC, 0],
    ["触れる点が1つの Mac", MAC, 1],
    ["Android", ANDROID, 5],
  ])("%s は数えない", (_, userAgent, touchPoints) => {
    expect(isAppleMobile(userAgent, touchPoints)).toBe(false);
  });
});

describe("購読を試せるか", () => {
  it("iPhone・iPad の Safari のタブでは、通知の API があっても試させず、ホーム画面への追加を案内する", () => {
    expect(notifyAvailability({ appleMobile: true, standalone: false, supported: true })).toBe(
      "ios",
    );
    expect(notifyAvailability({ appleMobile: true, standalone: false, supported: false })).toBe(
      "ios",
    );
  });

  it("ホーム画面に追加した iPhone・iPad のアプリでは試せる", () => {
    expect(notifyAvailability({ appleMobile: true, standalone: true, supported: true })).toBe(
      "available",
    );
  });

  it("iPhone・iPad でなければ、通知の API があるかで決める", () => {
    expect(notifyAvailability({ appleMobile: false, standalone: false, supported: true })).toBe(
      "available",
    );
    expect(notifyAvailability({ appleMobile: false, standalone: false, supported: false })).toBe(
      "unsupported",
    );
    expect(notifyAvailability({ appleMobile: true, standalone: true, supported: false })).toBe(
      "unsupported",
    );
  });
});

describe("受け取っているか", () => {
  it("購読があり、通知が許可されていれば ON", () => {
    expect(subscriptionStatus(true, "granted")).toBe("on");
  });

  it("購読が無いか、許可を聞く画面を閉じただけなら OFF（もう一度押せば聞き直せる）", () => {
    expect(subscriptionStatus(false, "granted")).toBe("off");
    expect(subscriptionStatus(false, "default")).toBe("off");
    expect(subscriptionStatus(true, "default")).toBe("off");
  });

  it("通知を拒んでいれば、購読が残っていても denied（届かないので ON に見せない）", () => {
    expect(subscriptionStatus(false, "denied")).toBe("denied");
    expect(subscriptionStatus(true, "denied")).toBe("denied");
  });
});
