/**
 * 「今週の配信スケジュール」動画の videoId。docs/adr/0004-schedule-thumbnail.md。
 *
 * 本人が概ね週替わりで更新する、スケジュール表を掲げた配信の動画ID。
 * タイトル・サムネイルは YouTube 側で更新されるが、動画自体（URL）は
 * 使い回されている運用（2026-09-09 時点で確認)。差し替わったときは
 * この1行を書き換える。
 *
 * src/lib に置かない理由は official.ts と同じ。
 */
export const SCHEDULE_VIDEO_ID = 'HlrD3dR_Xh8';

/**
 * scheduleData.ts ではなくここに置くのは、コンポーネントがビルド時の取得のモジュールを値として
 * 読まずに済むようにするため（型だけ読めば、実行時には何も入らない）。
 */
export const WATCH_URL = `https://www.youtube.com/watch?v=${SCHEDULE_VIDEO_ID}`;

/**
 * サムネイルの URL のクエリ `t` が変わる間隔。番号は端末の時計から作るので、時計のずれた端末では外れうる
 * （長さの理由は ADR-0004「サムネイルの URL にクエリを付ける」。外れうることも、同じ節で受け入れている）。
 */
export const T_WINDOW_MS = 5 * 60_000;
