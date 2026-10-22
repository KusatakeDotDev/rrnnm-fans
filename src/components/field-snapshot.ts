/**
 * 前回の畑の絵（ADR-0009「止められるようにする」）の保存先の名前。sessionStorage の項目。
 *
 * 敷く側（NemophilaField.tsx の SNAPSHOT_SCRIPT）と撮る側（NemophilaField.astro のラッパーのスクリプト）の
 * 両方がここから読むので、片方だけ名前が変わることは無い。キー（どの画面で撮った絵か）を作るのは SNAPSHOT_SCRIPT だけで、
 * root の `data-field-snapshot-key` に書き、撮る側はそれを読む。
 *
 * キーと絵を別の項目に置くのは、敷くスクリプトが最初の描画の前に走るため。キーだけ読んで比べ、
 * 合ったときだけ大きい絵を読む。
 */
export const SNAPSHOT_KEY_ITEM = 'field-snapshot-key';
export const SNAPSHOT_IMAGE_ITEM = 'field-snapshot';
/** 撮る側がキーを読み終えたら root に送るイベント。敷くスクリプトは、これを受けて大きさの監視を外す。 */
export const SNAPSHOT_READ_EVENT = 'field-snapshot-read';
/**
 * ウィンドウの幅と高さの小さい方がこれ未満なら「狭い画面」（花・株の数と解像度の上限を下げる。field-renderer.ts の mountField）。
 * 最初の1枚が変わるので、敷くスクリプトのキーにも入る。両方がここから読むので、しきい値が片方だけずれることは無い。
 */
export const SMALL_SCREEN_PX = 700;
/** 敷いた絵を、ラッパーのスクリプトが外さなくても外すまでの時間。バンドルしたスクリプトが読めなかったときに、止まった絵を残さない。 */
export const SNAPSHOT_GIVE_UP_MS = 8_000;
