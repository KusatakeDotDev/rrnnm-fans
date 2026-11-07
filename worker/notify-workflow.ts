/**
 * 配信スケジュールの更新を、購読している全員に送る Workflow（ADR-0035「送るのは Workflows に任せる」）。中身は worker/notify.ts の
 * deliver。`cloudflare:workers` は Workers の外では読み込めないので、単体テストが読み込む worker/index.ts とは分けて置く。
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { type DeliveryParams, deliver, type NotifyEnv } from "./notify";

export class NotifyWorkflow extends WorkflowEntrypoint<NotifyEnv, DeliveryParams> {
  override run(_event: Readonly<WorkflowEvent<DeliveryParams>>, step: WorkflowStep): Promise<void> {
    return deliver(step, this.env);
  }
}
