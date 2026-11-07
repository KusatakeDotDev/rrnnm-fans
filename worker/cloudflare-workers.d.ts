/**
 * `cloudflare:workers` のうち、worker/ で使う分の型。@cloudflare/workers-types（5.20261107.1）の同じ名前の宣言から、使う形だけを
 * 写した。依存を足さずに型を検査するため（ADR-0016）。
 */
declare module "cloudflare:workers" {
  export type WorkflowStepConfig = {
    retries?: {
      limit: number;
      delay: `${number} ${string}` | number;
      backoff?: "constant" | "linear" | "exponential";
    };
    timeout?: `${number} ${string}` | number;
  };

  export type WorkflowEvent<T> = {
    payload: Readonly<T>;
    timestamp: Date;
    instanceId: string;
    workflowName: string;
  };

  export interface WorkflowStep {
    do<T>(name: string, callback: () => Promise<T>): Promise<T>;
    do<T>(name: string, config: WorkflowStepConfig, callback: () => Promise<T>): Promise<T>;
  }

  export abstract class WorkflowEntrypoint<Env = unknown, T = unknown> {
    protected env: Env;
    run(event: Readonly<WorkflowEvent<T>>, step: WorkflowStep): Promise<unknown>;
  }
}
