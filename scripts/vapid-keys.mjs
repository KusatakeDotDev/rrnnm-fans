/**
 * 配信スケジュールの更新の通知（docs/adr/0035-schedule-push-notifications.md）で使う、VAPID の鍵の組を作る。
 *
 * 使い方:
 *   node scripts/vapid-keys.mjs > <書き出す先のファイル>
 *
 * 出すのは JSON の `{ "publicKey": "...", "privateKey": "..." }`。どちらも base64url で、公開鍵は圧縮していない P-256 の点
 * （ブラウザの `applicationServerKey` と同じ形）、秘密鍵は `d`。公開鍵は src/data/notify.ts に書き、秘密鍵は Worker の
 * シークレット `VAPID_PRIVATE_KEY` に置く（手順は docs/OPERATIONS.md）。画面に出さずにファイルへ書き出すのは、
 * 秘密鍵を端末の履歴やログに残さないため。
 */
import { webcrypto } from "node:crypto";

const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const raw = new Uint8Array(await webcrypto.subtle.exportKey("raw", publicKey));
const { d } = await webcrypto.subtle.exportKey("jwk", privateKey);

process.stdout.write(
  `${JSON.stringify({ publicKey: Buffer.from(raw).toString("base64url"), privateKey: d }, null, 2)}\n`,
);
