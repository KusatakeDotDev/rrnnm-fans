/**
 * トップのタイルに出す再生リスト。docs/adr/0008-playlist-carousel.md。
 *
 * **チャンネルの再生リストを全件は使わない。** 完走済みの特定タイトルのゲーム実況を指す
 * リストが大量にあり、全件並べるとそれで埋まる。**更新中のリストを人が選んで**ここに書く。
 * 足す・外すはこのファイルの編集で行うので、PR のレビューがそのまま選定の確認になる。
 *
 * **サムネイル直リンクの例外（ADR-0008「サムネイル表示の可否」）は、ここに書いた再生リストのカードにだけ掛かる。**
 * 表紙はブラウザで取るのでビルド成果物には出ず、縛りは PlaylistGrid.astro のスクリプトが持つ
 * （ADR-0008「例外の縛り方 — 成果物ではなく、スクリプトと純関数で」）。
 *
 * `label` は JS が無いとき・oEmbed が取れなかったときに出す名前。JS があれば、
 * ブラウザで本家の現在の名前に置き換わる（PlaylistGrid.astro）。
 * 本家で再生リストが消えてもサイトのビルドは落ちないので、週1回の監視
 * （scripts/check-playlists.mjs / .github/workflows/playlists-check.yml）で確かめる。
 *
 * 並び順に意味は無い。表示順は訪問ごとにブラウザで混ぜる（PlaylistGrid.astro）。
 * JS を切ったときだけ、この順で並ぶ。
 */
export const PLAYLISTS = [
  { id: "PLZFTCP6YjAYl_A2nzgmp92FJlW_-80FkP", label: "ASMR" },
  { id: "PLZFTCP6YjAYkgJu__kqN29B0IPTvXc0ff", label: "単発ゲーム配信🎮" },
  { id: "PLZFTCP6YjAYkWah0TMg_Qn0ImJSncs4LW", label: "マシュマロ雑談" },
  { id: "PLZFTCP6YjAYmk8rDihd3liPBxlCeeOhp_", label: "歌枠配信🎶" },
  { id: "PLZFTCP6YjAYkm62lYJPKLQsBYwdD_8fXt", label: "朗読配信📚" },
  { id: "PLZFTCP6YjAYnqLtrDPYcdHwd7XmflZjVj", label: "雑談配信・企画配信🌸" },
  { id: "PLZFTCP6YjAYlAPvFDrfyF-ecBgIGpPtNw", label: "見やすいやつ！" },
  // 本家の名前に合わせて「🤝」（2026-09-13 に oEmbed で確認）。
  { id: "PLZFTCP6YjAYkyUeqVD19XvsOgH2LZTJMS", label: "コラボ配信・動画🤝" },
  { id: "PLZFTCP6YjAYl7icdkPgnAZqlo9AIFY8w_", label: "歌ってみた動画" },
  { id: "PLZFTCP6YjAYl9GQHwU4xFFkQmZVu8p4Y3", label: "おすすめ動画5選" },
  { id: "PLZFTCP6YjAYl-bXgD6wCsEhdR0J0_ovMf", label: "おすすめ配信5選" },
] as const;

export const playlistUrl = (id: string): string => `https://www.youtube.com/playlist?list=${id}`;
