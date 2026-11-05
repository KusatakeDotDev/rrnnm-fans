/**
 * 中身（ペイロード）の無い Web Push を送るための、宛先の検査と VAPID（RFC 8292）の署名の材料（ADR-0035 の決定）。
 * 署名と送信は Worker（worker/notify.ts）がする。fetch も WebCrypto もここでは呼ばない（ADR-0003「層1 — 純関数だけを置く」）。
 */

/** 受け付ける push のサービスのホスト。ブラウザの外から送り込まれた URL へ、Worker にリクエストを出させないため。 */
const PUSH_HOSTS: readonly string[] = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
];
/** Windows の push のサービス（Edge）は、`wns2-bl2p.notify.windows.com` のように、ホストが地域ごとに分かれる。 */
const PUSH_HOST_SUFFIX = ".notify.windows.com";

/** 宛先を置く KV のキーのメタデータの上限（バイト）。宛先は、JSON の文字列としてここに置く。 */
export const MAX_METADATA_BYTES = 1024;

/** VAPID の JWT を有効にしておく秒数。Apple は、1日より先の `exp` を受け付けない（BadJwtToken）。 */
export const VAPID_TTL_S = 12 * 60 * 60;

/** 受け付けた宛先。`endpoint` は整えた URL で、KV に置くのも送るのもこちら。`audience` は JWT の `aud` に入れるオリジン。 */
export interface PushTarget {
  endpoint: string;
  audience: string;
}

/**
 * 宛先の URL が、受け付ける push のサービスのものなら、整えた URL と JWT の `aud` を返す。違えば null。
 * 型を問わずに受けるのは、ブラウザから届いた JSON の値と、KV のメタデータをそのまま渡すため。
 */
export function pushTarget(value: unknown): PushTarget | null {
  if (typeof value !== "string") return null;
  const url = URL.parse(value);
  if (
    !url ||
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null;
  }
  // 整えた URL は ASCII だけになるので、JSON の文字列の長さがそのままバイト数になる（クエリとフラグメントに残る `\` は、エスケープで伸びる）。
  if (JSON.stringify(url.href).length > MAX_METADATA_BYTES) return null;
  const host = url.hostname;
  const known =
    PUSH_HOSTS.includes(host) ||
    (host.endsWith(PUSH_HOST_SUFFIX) && host.length > PUSH_HOST_SUFFIX.length);
  return known ? { endpoint: url.href, audience: url.origin } : null;
}

/** 購読を足す・消すリクエストの本文（`{ "endpoint": "<宛先の URL>" }`）から、受け付ける宛先を整えて読む。読めなければ null。 */
export function readEndpoint(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("endpoint" in body)) return null;
  return pushTarget(body.endpoint)?.endpoint ?? null;
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** `atob` はパディングの `=` が無くても読む（HTML の forgiving-base64 decode）ので、足さない。 */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const json = (value: object) => base64url(new TextEncoder().encode(JSON.stringify(value)));

/** VAPID の JWT のうち、署名する部分（`<ヘッダー>.<クレーム>`）。`now` は `Date.now()` と同じ、ミリ秒の時刻。 */
export function vapidSigningInput(audience: string, subject: string, now: number): string {
  const exp = Math.floor(now / 1000) + VAPID_TTL_S;
  return `${json({ typ: "JWT", alg: "ES256" })}.${json({ aud: audience, exp, sub: subject })}`;
}

/**
 * push のリクエストの `Authorization` ヘッダー。`signature` は WebCrypto の ECDSA の署名（r と s を並べた 64 バイト）で、
 * JWS（ES256）の署名の形と同じなので、そのまま使える。
 */
export function vapidAuthorization(
  signingInput: string,
  signature: Uint8Array,
  publicKey: string,
): string {
  return `vapid t=${signingInput}.${base64url(signature)}, k=${publicKey}`;
}

/**
 * VAPID の秘密鍵（P-256 の `d` を base64url にしたもの）を、WebCrypto に読ませる JWK にする。`x`・`y` は公開鍵
 * （圧縮していない点を base64url にしたもの。ブラウザの `applicationServerKey` と同じ形）から取る。秘密鍵と別に持つと、
 * 食い違ったときに、push のサービスが 403 を返すまで気づけないため。
 */
export function vapidPrivateJwk(publicKey: string, privateKey: string): JsonWebKey {
  const point = fromBase64url(publicKey);
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error(
      "VAPID の公開鍵は、圧縮していない P-256 の点（65 バイト）を base64url にしたものにする",
    );
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: base64url(point.subarray(1, 33)),
    y: base64url(point.subarray(33)),
    d: privateKey,
  };
}

/** 宛先を消す応答か。404・410 は、購読が切れた（やめた・期限が切れた）ことを表す（RFC 8030）。 */
export function isGone(status: number): boolean {
  return status === 404 || status === 410;
}
