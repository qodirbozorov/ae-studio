/**
 * Op runner: oplarni qat'iy ketma-ket bajaradi (bitta evalScript = bitta op, AE UI bloklanmaydi).
 * `submitBatch` (P6.04): sahna oplari bitta evalScript'da — o'sha navbatda, boshqa oplar bilan aralashmaydi.
 * Har op AE'ga yuborilishidan oldin zod sxemasi va fayl yo'llari (ish papkasi ichida) tekshiriladi.
 */
import { OP_PATH_PARAMS, failWith, parseOpEnvelope, resolveInsideRoot } from "@aes/shared";
import type { AeResponse, AesError, OpEnvelope, OpResultData } from "@aes/shared";
import type { AeBridge } from "./ae-bridge";
import type { LogStore } from "./log";

/** `batch: true` — batch ichidagi op: natija serverga `ops.batch.result` bilan boradi. */
export type RunnerEvent =
  | { type: "op.started"; op: OpEnvelope; job_id?: string; ts: number; batch?: true }
  | {
      type: "op.done";
      op: OpEnvelope;
      job_id?: string;
      result: OpResultData;
      duration_ms: number;
      batch?: true;
    }
  | {
      type: "op.failed";
      op: OpEnvelope | null;
      job_id?: string;
      error: AesError;
      duration_ms: number;
      batch?: true;
    };

export type BatchItemOutcome =
  | { op_id: string; ok: true; result: OpResultData; duration_ms: number }
  | { op_id: string; ok: false; error: AesError; duration_ms: number };

export interface BatchOutcome {
  /** Bajarilgan oplar tartibda (xato bo'lsa u oxirgisi); ro'yxatda yo'qlari bajarilmagan. */
  results: BatchItemOutcome[];
  /** Batch umuman bajarilmadi (AE yopiq, timeout, jsx yuklanmagan). */
  error?: AesError;
  duration_ms: number;
}

/** Batch uchun umumiy timeout yuqori chegarasi (op timeout'lari yig'indisi shundan oshmaydi). */
export const BATCH_TIMEOUT_CAP_MS = 30 * 60_000;

export interface OpOutcome {
  op: OpEnvelope | null;
  response: AeResponse;
  duration_ms: number;
}

export interface OpRunner {
  /** Navbatga qo'yadi; natija op bajarilgandan keyin qaytadi. */
  submit(input: unknown, jobId?: string): Promise<OpOutcome>;
  /** Oplar bitta evalScript'da (sahna, P6.04). */
  submitBatch(inputs: unknown[], jobId?: string, label?: string): Promise<BatchOutcome>;
  onEvent(listener: (event: RunnerEvent) => void): () => void;
  /** Hozir bajarilayotgan op (resume uchun `hello.running`). */
  current(): { op: OpEnvelope; job_id?: string } | null;
}

export function createOpRunner(options: {
  bridge: AeBridge;
  log: LogStore;
  getRoot: () => string;
  now?: () => number;
  /** AE javobidan keyingi tekshiruv (masalan `frames.capture` fayllarini kutish); xato bo'lsa op.failed. */
  afterOp?: (op: OpEnvelope, result: OpResultData) => Promise<AesError | null>;
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
      if (options.afterOp !== undefined) {
        const after = await options.afterOp(op, response.data);
        if (after !== null) return failed(op, after, started, jobId);
      }
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

  function batchFailure(
    op: OpEnvelope | null,
    opId: string,
    error: AesError,
    ms: number,
    jobId?: string,
  ) {
    log.add({
      level: "error",
      message: `❌ ${op?.op ?? opId} — ${error.code}${error.message ? ": " + error.message : ""}`,
      op_id: opId,
      job_id: jobId,
      data: error,
    });
    emit({ type: "op.failed", op, job_id: jobId, error, duration_ms: ms, batch: true });
    const item: BatchItemOutcome = { op_id: opId, ok: false, error, duration_ms: ms };
    return item;
  }

  async function executeBatch(
    inputs: unknown[],
    jobId?: string,
    label?: string,
  ): Promise<BatchOutcome> {
    const started = now();
    const ops: OpEnvelope[] = [];
    // Tekshiruvdan o'tmagan op: undan oldingilari bajariladi, o'zi xato sifatida qaytadi.
    let rejected: { op: OpEnvelope | null; opId: string; error: AesError } | null = null;
    for (const input of inputs) {
      const parsed = parseOpEnvelope(input);
      const rawId = (input as { op_id?: unknown } | null)?.op_id;
      const opId = typeof rawId === "string" ? rawId : "?";
      if (!parsed.ok) {
        rejected = { op: null, opId, error: parsed.error };
        break;
      }
      const pathError = checkPaths(parsed.data);
      if (pathError !== null) {
        rejected = { op: parsed.data, opId, error: pathError };
        break;
      }
      ops.push(parsed.data);
    }
    const name = label ?? ops[0]?.scene_id ?? "batch";
    const results: BatchItemOutcome[] = [];
    if (ops.length > 0) {
      running = { op: ops[0]!, job_id: jobId };
      log.add({ level: "info", message: `⏳ ${name}: ${ops.length} op`, job_id: jobId });
      for (const op of ops) {
        emit({ type: "op.started", op, job_id: jobId, ts: started, batch: true });
      }
      try {
        let timeout = 0;
        for (const op of ops) timeout += op.timeout_ms;
        const response = await bridge.runBatch(
          ops,
          { root: getRoot() },
          { label: name, timeoutMs: Math.min(timeout, BATCH_TIMEOUT_CAP_MS) },
        );
        if (!response.ok) {
          batchFailure(ops[0]!, ops[0]!.op_id, response.error, now() - started, jobId);
          return { results, error: response.error, duration_ms: now() - started };
        }
        const byId = new Map(ops.map((op) => [op.op_id, op]));
        for (const item of response.data.results) {
          const op = byId.get(item.op_id) ?? null;
          if (!item.ok) {
            results.push(batchFailure(op, item.op_id, item.error, item.ms, jobId));
            break;
          }
          const after =
            op !== null && options.afterOp !== undefined
              ? await options.afterOp(op, item.data)
              : null;
          if (after !== null) {
            results.push(batchFailure(op, item.op_id, after, item.ms, jobId));
            break;
          }
          if (op !== null) {
            emit({
              type: "op.done",
              op,
              job_id: jobId,
              result: item.data,
              duration_ms: item.ms,
              batch: true,
            });
          }
          results.push({ op_id: item.op_id, ok: true, result: item.data, duration_ms: item.ms });
        }
      } finally {
        running = null;
      }
    }
    const allDone = results.length === ops.length && !results.some((r) => !r.ok);
    if (rejected !== null && allDone) {
      results.push(batchFailure(rejected.op, rejected.opId, rejected.error, 0, jobId));
    }
    const duration = now() - started;
    if (!results.some((r) => !r.ok)) {
      log.add({
        level: "info",
        message: `✅ ${name}: ${results.length} op ${duration} ms`,
        job_id: jobId,
      });
    }
    return { results, duration_ms: duration };
  }

  return {
    submit(input, jobId) {
      const result = queue.then(() => execute(input, jobId));
      queue = result.catch(() => undefined);
      return result;
    },
    submitBatch(inputs, jobId, label) {
      const result = queue.then(() => executeBatch(inputs, jobId, label));
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
