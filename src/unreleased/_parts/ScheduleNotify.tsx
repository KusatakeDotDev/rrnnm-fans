/**
 * 今週の配信予定のカードの下端に置く、スケジュールの更新の通知を受け取るかのスイッチ（ADR-0035）。
 * 何の更新かは、予定のカードの中に置くことで伝え、文は短い1行にする。押せないときと、うまくいかなかったときだけ、
 * その理由を下に出す。
 *
 * 状態ごとの文をすべて描き、出し分けは属性に任せる。ページでは、ラッパー（ScheduleNotify.astro）のスクリプトが
 * root の `data-state`・`data-failed` と、スイッチの `aria-checked`・`aria-disabled` を書き換えるだけで済み、
 * 文をスクリプトに二重に持たずに済むため。スイッチの位置は `aria-checked` で描き、確かめている（`pending`）あいだも
 * 押す前の位置のままにする。
 */
import { useId, type HTMLAttributes } from "react";

import { cx } from "../../lib/cx";
import styles from "./ScheduleNotify.module.css";

interface ScheduleNotifyProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "dangerouslySetInnerHTML"
> {
  /**
   * 何を出すか。`loading` は、スクリプトが購読を確かめ終えるまで。場所だけ取って何も見せず、受け取っている人に
   * OFF を一瞬見せない。`pending` は、OFF から切り替えている途中。`denied` は通知を拒んでいるとき、
   * `ios` は iPhone・iPad の Safari のタブ（ホーム画面に追加しないと受け取れない）、`unsupported` は通知の無いブラウザ。
   */
  state?: "loading" | "off" | "pending" | "on" | "denied" | "ios" | "unsupported";
  /** 切り替えられなかったことを、スイッチの下に出す。スイッチは、そのときの本当の位置で描く。 */
  failed?: boolean;
  /** 解除のしかたと、ホーム画面への追加のしかたを書いたページ。渡さなければ、リンクにせず文だけを出す。 */
  helpHref?: string;
}

const UNAVAILABLE = new Set(["denied", "ios", "unsupported"]);

export default function ScheduleNotify({
  state = "loading",
  failed = false,
  helpHref,
  className,
  ...rest
}: ScheduleNotifyProps) {
  const note = useId();
  return (
    <div
      className={cx(styles.root, className)}
      {...rest}
      data-schedule-notify
      data-state={state}
      data-failed={failed || undefined}
    >
      <button
        type="button"
        role="switch"
        className={styles.toggle}
        aria-checked={state === "on"}
        aria-disabled={state === "pending" || UNAVAILABLE.has(state) || undefined}
        aria-describedby={note}
        data-schedule-notify-toggle
      >
        {/* ON は鳴っているベル、OFF は斜線の入ったベル。スイッチの位置と色に加えて、形でも分ける。 */}
        <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <g className={styles.waves}>
            <path d="M3.2 9.2a9 9 0 0 1 2.6-5" />
            <path d="M20.8 9.2a9 9 0 0 0-2.6-5" />
          </g>
          <path
            className={styles.bell}
            d="M12 2.6a1.6 1.6 0 0 1 1.6 1.6v.5a6.2 6.2 0 0 1 4.6 6V14l1.7 2.5a.9.9 0 0 1-.8 1.4H4.9a.9.9 0 0 1-.8-1.4L5.8 14v-3.3a6.2 6.2 0 0 1 4.6-6v-.5A1.6 1.6 0 0 1 12 2.6Z"
          />
          <path className={styles.bell} d="M9.6 19.2a2.4 2.4 0 0 0 4.8 0Z" />
          <g className={styles.slash}>
            <path className={styles.slashGap} d="M4.5 3.5 19.5 20.5" />
            <path d="M4.5 3.5 19.5 20.5" />
          </g>
        </svg>
        <span className={styles.label}>更新を通知する</span>
        <span className={styles.switch} aria-hidden="true">
          <span className={styles.knob}>
            <svg
              className={styles.spinner}
              viewBox="0 0 24 24"
              focusable="false"
              data-when="pending"
            >
              <circle cx="12" cy="12" r="8" />
            </svg>
          </span>
        </span>
      </button>
      <p className={styles.note} id={note} role="status">
        <span className={styles.failed}>
          <span className={styles.phrase}>切り替えられませんでした。</span>
          <span className={styles.phrase}>もう一度お試しください</span>
        </span>
        <span data-when="denied">
          <span className={styles.phrase}>通知がブロックされています。</span>
          {/* 手引きが無いときは出さない。文だけでは、どこにも書いていない手順を指してしまう。 */}
          {helpHref && (
            <a className={styles.phrase} href={helpHref}>
              解除のしかた
            </a>
          )}
        </span>
        <span data-when="ios">
          {helpHref ? (
            <a href={helpHref}>ホーム画面に追加すると通知できます</a>
          ) : (
            "ホーム画面に追加すると通知できます"
          )}
        </span>
        <span data-when="unsupported">このブラウザでは通知を受け取れません</span>
      </p>
    </div>
  );
}
