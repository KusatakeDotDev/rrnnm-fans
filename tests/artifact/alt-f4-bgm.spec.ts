import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { builtRoutes, DIST } from "../helpers/dist";

test("配信をとじろの本物の BGM を配る", () => {
  test.skip(!builtRoutes().includes("/play/alt-f4/"), "配信をとじろのページを生成しないビルド");
  const dir = path.join(DIST, "_astro");
  // ビルドの出力は _astro/<名前>.<フィンガープリント>.m4a。
  const shipped = (existsSync(dir) ? readdirSync(dir) : []).filter((file) =>
    /^maou_14_shining_star\.[\w-]+\.m4a$/.test(file),
  );
  // 曲は非公開のリポジトリから重ねる（ADR-0034 の決定）。重ねていないビルドは無音で鳴らすので、Release は無ければ止める。
  test.skip(
    shipped.length === 0 && process.env.REQUIRE_PRIVATE_ASSETS !== "1",
    "非公開の素材を重ねていないビルド",
  );
  expect(shipped).toHaveLength(1);
});
