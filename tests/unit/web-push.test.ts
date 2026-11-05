import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";

import {
  base64url,
  fromBase64url,
  hex,
  isGone,
  MAX_METADATA_BYTES,
  pushTarget,
  readEndpoint,
  VAPID_TTL_S,
  vapidAuthorization,
  vapidPrivateJwk,
  vapidSigningInput,
} from "../../src/lib/web-push";

/**
 * src/lib/web-push.ts — 中身の無い Web Push を送るための、宛先の検査と VAPID の署名の材料（docs/adr/0035-schedule-push-notifications.md）。
 * 壊れると「ブラウザの外から送り込まれた URL へ Worker がリクエストを出す」「push のサービスが署名を受け付けない（403）」
 * 「やめた人の宛先を消さずに送り続ける」の形で出る。
 */

const decodeJson = (part: string) => JSON.parse(new TextDecoder().decode(fromBase64url(part)));

describe("宛先の URL", () => {
  it.each([
    ["https://fcm.googleapis.com/fcm/send/abc:def", "https://fcm.googleapis.com"],
    [
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://updates.push.services.mozilla.com",
    ],
    ["https://web.push.apple.com/QGx-abc", "https://web.push.apple.com"],
    ["https://wns2-bl2p.notify.windows.com/w/?token=abc", "https://wns2-bl2p.notify.windows.com"],
  ])(
    "push のサービスの URL なら、その URL と、JWT の aud に入れるオリジンを返す（%s）",
    (endpoint, audience) => {
      expect(pushTarget(endpoint)).toEqual({ endpoint, audience });
    },
  );

  it('URL は整えて返す（大文字のホスト・既定のポート・`..`・ASCII でない文字・`"`）', () => {
    expect(pushTarget('https://WEB.push.apple.com:443/a/../b/é"')).toEqual({
      endpoint: "https://web.push.apple.com/b/%C3%A9%22",
      audience: "https://web.push.apple.com",
    });
  });

  it.each([
    ["http で来た", "http://fcm.googleapis.com/fcm/send/abc"],
    ["ポートを付けた", "https://fcm.googleapis.com:8443/fcm/send/abc"],
    ["ユーザー名を付けた", "https://user@fcm.googleapis.com/fcm/send/abc"],
    ["ほかのホスト", "https://example.com/fcm/send/abc"],
    ["許すホストを含むだけのホスト", "https://fcm.googleapis.com.example.com/abc"],
    ["許すホストの頭に足したホスト", "https://evilfcm.googleapis.com/abc"],
    ["Windows の push のサービスの、地域の無いホスト", "https://notify.windows.com/w/?token=abc"],
    ["Windows の push のサービスの、点だけのホスト", "https://.notify.windows.com/w/?token=abc"],
    ["URL でない", "not a url"],
  ])("受け付けない（%s）", (_, endpoint) => {
    expect(pushTarget(endpoint)).toBeNull();
  });

  /** KV のメタデータに置く形（JSON の文字列）の UTF-8 のバイト数。 */
  const metadataBytes = (endpoint: string) =>
    new TextEncoder().encode(JSON.stringify(endpoint)).length;
  const head = "https://fcm.googleapis.com/fcm/send/";

  it("KV のメタデータ（1024 バイト）に収まる URL までを受け付ける", () => {
    expect(MAX_METADATA_BYTES).toBe(1024);
    const longest = head + "a".repeat(MAX_METADATA_BYTES - 2 - head.length);
    expect(metadataBytes(pushTarget(longest)!.endpoint)).toBe(MAX_METADATA_BYTES);
    expect(pushTarget(longest + "a")).toBeNull();
  });

  it("ASCII でない文字は、整えた URL の長さ（%エンコードしたあと）で数える", () => {
    // 1文字が %C3%A9 の6文字になる。文字数では1024に届かなくても、整えると越える。
    expect(head.length + 170).toBeLessThan(MAX_METADATA_BYTES);
    expect(pushTarget(head + "é".repeat(170))).toBeNull();
    expect(metadataBytes(pushTarget(head + "é".repeat(150))!.endpoint)).toBeLessThanOrEqual(1024);
  });

  it("JSON のエスケープで伸びる文字（クエリに残る `\\`）も数える", () => {
    const backslash = String.fromCharCode(92);
    const query = `${head}a?`;
    const fits = query + backslash.repeat((MAX_METADATA_BYTES - 2 - query.length) / 2);
    expect(metadataBytes(pushTarget(fits)!.endpoint)).toBe(MAX_METADATA_BYTES);
    expect(pushTarget(fits + "a")).toBeNull();
  });

  it.each([[null], [undefined], [1], [{}], [new URL("https://web.push.apple.com/abc")]])(
    "文字列でなければ、文字列にすると受け付ける URL になるものでも受け付けない（%j）",
    (value) => {
      expect(pushTarget(value)).toBeNull();
    },
  );
});

describe("購読のリクエストの本文", () => {
  it("endpoint が受け付ける URL なら、整えた URL を返す", () => {
    expect(readEndpoint({ endpoint: "https://WEB.push.apple.com:443/a/../abc" })).toBe(
      "https://web.push.apple.com/abc",
    );
    expect(readEndpoint({ endpoint: "https://web.push.apple.com/abc", keys: {} })).toBe(
      "https://web.push.apple.com/abc",
    );
  });

  it.each([
    ["null", null],
    ["文字列", "https://web.push.apple.com/abc"],
    ["endpoint が無い", { url: "https://web.push.apple.com/abc" }],
    ["受け付けない URL", { endpoint: "https://example.com/abc" }],
    ["文字列でない endpoint", { endpoint: 1 }],
  ])("読めなければ null（%s）", (_, body) => {
    expect(readEndpoint(body)).toBeNull();
  });
});

describe("base64url", () => {
  it("+ と / を - と _ にし、埋め草の = を付けない", () => {
    expect(base64url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
    expect(base64url(new Uint8Array([0xfb, 0xef, 0xbe]))).toBe("----");
    expect(base64url(new Uint8Array([0xff, 0xff, 0xff]))).toBe("____");
    expect(base64url(new Uint8Array([1]))).toBe("AQ");
    expect(base64url(new Uint8Array([]))).toBe("");
  });

  it("読み戻すと、どの長さでも元のバイト列になる", () => {
    for (let length = 0; length <= 7; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 97 + 0xf0) % 256);
      expect(fromBase64url(base64url(bytes))).toEqual(bytes);
    }
  });

  it("- と _ を読む", () => {
    expect(fromBase64url("-_8")).toEqual(new Uint8Array([0xfb, 0xff]));
    expect(fromBase64url("____")).toEqual(new Uint8Array([0xff, 0xff, 0xff]));
  });
});

describe("hex", () => {
  it("1バイトを2桁の小文字の16進数にする", () => {
    expect(hex(new Uint8Array([0, 9, 10, 255]))).toBe("00090aff");
  });
});

describe("VAPID の JWT", () => {
  const NOW = Date.parse("2026-11-05T12:00:00Z");

  it("ヘッダーは ES256 で、クレームは aud・exp（12時間後の秒）・sub", () => {
    const [header, claims, ...rest] = vapidSigningInput(
      "https://web.push.apple.com",
      "https://rrnnm.fans/about/",
      NOW + 999,
    ).split(".");
    expect(rest).toEqual([]);
    expect(decodeJson(header!)).toEqual({ typ: "JWT", alg: "ES256" });
    expect(decodeJson(claims!)).toEqual({
      aud: "https://web.push.apple.com",
      exp: NOW / 1000 + VAPID_TTL_S,
      sub: "https://rrnnm.fans/about/",
    });
  });

  it("有効期間は、Apple が受け付ける1日より短い", () => {
    expect(VAPID_TTL_S).toBe(12 * 60 * 60);
  });

  it("Authorization ヘッダーは、署名を足した JWT と公開鍵を vapid の形で並べる", () => {
    expect(vapidAuthorization("aaa.bbb", new Uint8Array([0xfb, 0xff]), "KEY")).toBe(
      "vapid t=aaa.bbb.-_8, k=KEY",
    );
  });
});

describe("VAPID の秘密鍵", () => {
  it("公開鍵から x・y を取った JWK にすると、WebCrypto で署名でき、公開鍵で確かめられる", async () => {
    const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const publicKey = base64url(
      new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey)),
    );
    const { d } = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
    const jwk = vapidPrivateJwk(publicKey, d!);
    expect(Object.keys(jwk).sort()).toEqual(["crv", "d", "kty", "x", "y"]);
    const key = await webcrypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const data = new TextEncoder().encode("aaa.bbb");
    const signature = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data);
    expect(signature.byteLength).toBe(64);
    expect(
      await webcrypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        pair.publicKey,
        signature,
        data,
      ),
    ).toBe(true);
  });

  it.each([
    ["圧縮した点（33 バイト）", base64url(new Uint8Array([2, ...new Uint8Array(32)]))],
    ["頭が 4 でない 65 バイト", base64url(new Uint8Array([5, ...new Uint8Array(64)]))],
    ["66 バイト", base64url(new Uint8Array([4, ...new Uint8Array(65)]))],
  ])("公開鍵が圧縮していない点でなければ、投げる（%s）", (_, publicKey) => {
    expect(() => vapidPrivateJwk(publicKey, "d")).toThrow("VAPID の公開鍵");
  });
});

describe("切れた宛先", () => {
  it("404 と 410 は消し、ほかは消さない", () => {
    expect(isGone(404)).toBe(true);
    expect(isGone(410)).toBe(true);
    for (const code of [201, 400, 403, 405, 413, 429, 500, 503]) expect(isGone(code)).toBe(false);
  });
});
