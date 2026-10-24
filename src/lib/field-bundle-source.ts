// Stryker disable all: import.meta.glob の引数は Vite が静的に読むので、書き換えると解析できない。ミューテーションテストは素材を重ねずに回すので、残りも無いときの分岐しか通らない
import type { FieldMesh } from "./field";

export type ParseFieldBundle = (
  buffer: ArrayBuffer,
) => { mesh: FieldMesh; texture: Uint8Array<ArrayBuffer> } | null;

// 購入した素材の許諾は公開リポジトリでの再配布を含まないので、読み解き方は非公開のリポジトリから重ねる（RRNNM-44）。
// 重ねていないビルドでは null を返し、株を描かずに一枚絵の花だけで描く。
const modules = import.meta.glob<ParseFieldBundle>("./field-bundle.ts", {
  eager: true,
  import: "parseFieldBundle",
});

export const parseFieldBundle: ParseFieldBundle = modules["./field-bundle.ts"] ?? (() => null);
