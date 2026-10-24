import NemophilaField from "../../src/components/NemophilaField.tsx";
import type { FieldState } from "../../src/lib/field";

// トップの畑と見出し。NemophilaField の story と SiteHeader の overlay の story が同じものを描く。
// 見出しは children に h1 を入れ、句ごとに span で包む（そこで改行する）。
export const lede = "瑠璃野ねも 非公式ファンサイト";

export const FieldHero = ({ state }: { state?: FieldState }) => (
  <NemophilaField lede={lede} state={state}>
    <h1>
      <span>とっても可憐な</span>
      <span>ネモフィラの妖精</span>
    </h1>
  </NemophilaField>
);
