import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { assertDeployable } from "./dist-receipt.mjs";

rmSync("dist.verified.json", { force: true });
const receipt = assertDeployable();
const html = readFileSync("dist/index.html", "utf8");
const images = [...html.matchAll(/<img\b[^>]*>/g)]
  .map(([tag]) => ({
    url: /\ssrc="([^"]+)"/.exec(tag)?.[1],
    width: Number(/\swidth="(\d+)"/.exec(tag)?.[1]),
    height: Number(/\sheight="(\d+)"/.exec(tag)?.[1]),
  }))
  .filter(({ url }) => url?.startsWith("https://i.ytimg.com/vi/"));
if (images.length !== 1) throw new Error("予定の画像が1枚ではない。配布を停止する");
for (const { url, width, height } of images) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`予定画像の取得失敗: ${response.status}`);
  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  if (metadata.width !== width || metadata.height !== height)
    throw new Error("予定画像の寸法が一致しない");
}
// グッズのページを出すビルドで BOOTH から画像を1枚も取れなかったら、配布は止めず、注意だけを出す
// （docs/adr/0020-booth-goods-images.md「払うもの」）。テストの側は、実データのビルドではこれを見ない。
if (
  existsSync("dist/goods/index.html") &&
  !readFileSync("dist/goods/index.html", "utf8").includes("booth.pximg.net/")
) {
  const message =
    "グッズのページに BOOTH の画像が1枚も無い。取れなかった理由は、ビルドのログの [goods] の行にある";
  console.log(
    process.env.GITHUB_ACTIONS === "true"
      ? `::warning title=BOOTH の画像::${message}`
      : `注意: ${message}`,
  );
}
const result = spawnSync("pnpm", ["test:e2e"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.status !== 0) process.exit(result.status ?? 1);
assertDeployable();
writeFileSync("dist.verified.json", JSON.stringify(receipt));
