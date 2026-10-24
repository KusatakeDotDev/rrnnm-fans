import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { CHEERS, MISSES, REACTIONS } from "../../src/lib/kusobaka-slot";
import { DIST } from "../helpers/dist";

test("クソバカスロットの本物の音を、名前ごとに1本ずつ配る", () => {
  const dir = path.join(DIST, "_astro");
  // ビルドの出力は _astro/<名前>.<フィンガープリント>.mp3。無音のファイル（kusobaka-slot-silent）は本物ではないので数えない。
  const shipped = (existsSync(dir) ? readdirSync(dir) : [])
    .flatMap((file) => /^([\w-]+)\.[\w-]+\.mp3$/.exec(file)?.[1] ?? [])
    .filter((name) => name !== "kusobaka-slot-silent")
    .sort();
  // 音は非公開のリポジトリから重ねる（ADR-0029 の決定）。重ねていないビルドは無音で鳴らすので、Release は無ければ止める。
  test.skip(
    shipped.length === 0 && process.env.REQUIRE_PRIVATE_ASSETS !== "1",
    "非公開の素材を重ねていないビルド",
  );
  expect(shipped).toEqual(["stop", "success", ...REACTIONS, ...CHEERS, ...MISSES].sort());
});
