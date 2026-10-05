/**
 * Op runner: oplarni qat'iy ketma-ket bajaradi (bitta evalScript = bitta op, AE UI bloklanmaydi).
 * Har op AE'ga yuborilishidan oldin zod sxemasi va fayl yo'llari (ish papkasi ichida) tekshiriladi.
 */
import { OP_PATH_PARAMS, failWith, parseOpEnvelope, resolveInsideRoot } from "@aes/shared";
import type { AeResponse, AesError, OpEnvelope, OpResultData } from "@aes/shared";
import type { AeBridge } from "./ae-bridge";
import type { LogStore } from "./log";

export type RunnerEvent =
  | { type: "op.started"; op: OpEnvelope; job_id?: string; ts: number }
  | {
      type: "op.done";
      op: OpEnvelope;
      job_id?: string;
      result: OpResultData;
      duration_ms: number;
    }
  | {
      type: "op.failed";
      op: OpEnvelope | null;
      job_id?: string;
      error: AesError;
      duration_ms: number;
    };

export interface OpOutcome {
  op: OpEnvelope | null;
  response: AeResponse;
  duration_ms: number;
}

export interface OpRunner {
  /** Navbatga qo'yadi; natija op bajarilgandan keyin qaytadi. */
  submit(input: unknown, jobId?: string): Promise<OpOutcome>;
  onEvent(listener: (event: RunnerEvent) => void): () => void;
  /** Hozir bajarilayotgan op (resume uchun `hello.running`). */
  current(): { op: OpEnvelope; job_id?: string } | null;
}

export function createOpRunner(options: {
  bridge: AeBridge;
  log: LogStore;
  getRoot: () => string;
  now?: () => number;
}): OpRunner {
  const { bridge, log, getRoot } = options;
  const now = options.now ?? Date.now;
  const listeners = new Set<(event: RunnerEvent) => void>();
  let queue: Promise<unknown> = Promise.resolve();
  let running: { op: OpEnvelope; job_id?: string } | null = null;

  const emit = (event: RunnerEvent) => {
    for (const listener of listeners) listener(event);
  };

  function failed(op: OpEnvelope | null, error: AesError, started: number, jobId?: string) {
    const duration = now() - started;
    log.add({
      level: "error",
      message: `❌ ${op?.op ?? "op"} — ${error.code}${error.message ? ": " + error.message : ""}`,
      op_id: op?.op_id,
      job_id: jobId,
      data: error,
    });
    emit({ type: "op.failed", op, job_id: jobId, error, duration_ms: duration });
    return { op, response: failWith(error), duration_ms: duration };
  }

  /** Yo'l parametrlari ish papkasi ichida ekanini tekshiradi (§4.4). */
  function checkPaths(op: OpEnvelope): AesError | null {
    const fields = OP_PATH_PARAMS[op.op] ?? [];
    const params = op.params as unknown as Record<string, unknown>;
    for (const field of fields) {
      const value = params[field];
      if (typeof value !== "string") continue;
      const resolved = resolveInsideRoot(getRoot(), value);
      if (!resolved.ok) return resolved.error;
    }
    return null;
  }

  async function execute(input: unknown, jobId?: string): Promise<OpOutcome> {
    const started = now();
    const parsed = parseOpEnvelope(input);
    if (!parsed.ok) return failed(null, parsed.error, started, jobId);
    const op = parsed.data;

    const pathError = checkPaths(op);
    if (pathError !== null) return failed(op, pathError, started, jobId);

    running = { op, job_id: jobId };
    log.add({
      level: "info",
      message: `⏳ ${op.op} (${op.op_id})`,
      op_id: op.op_id,
      job_id: jobId,
    });
    emit({ type: "op.started", op, job_id: jobId, ts: started });
    try {
      const response = await bridge.runOp(op, { root: getRoot() });
      if (!response.ok) return failed(op, response.error, started, jobId);
      const duration = now() - started;
      const reused = response.data.reused ? " (avvaldan bor)" : "";
      log.add({
        level: "info",
        message: `✅ ${op.op} ${duration} ms${reused}`,
        op_id: op.op_id,
        job_id: jobId,
        data: response.data,
      });
      emit({ type: "op.done", op, job_id: jobId, result: response.data, duration_ms: duration });
      return { op, response, duration_ms: duration };
    } finally {
      running = null;
    }
  }

  return {
    submit(input, jobId) {
      const result = queue.then(() => execute(input, jobId));
      queue = result.catch(() => undefined);
      return result;
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current: () => running,
  };
}
