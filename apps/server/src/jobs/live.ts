/**
 * Live log (§2.1, P2.12): `job_events` va holat o'zgarishlari → WS → panel (`job.update`, `job.event`).
 * Panel qayta ulanganda (`hello`) aktiv job holati darhol yuboriladi; panelning `log` xabarlari job log'iga yoziladi.
 */
import type { AesError, ServerMessageOf } from "@aes/shared";
import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../context";
import { jobEvents } from "../db/schema";
import type { JobEngine, JobProgress, JobRow } from "./engine";

export function jobUpdate(job: JobRow, progress: JobProgress): ServerMessageOf<"job.update"> {
  const message: ServerMessageOf<"job.update"> = {
    type: "job.update",
    job_id: job.id,
    state: job.state,
    progress: { done: progress.done, total: progress.total },
    paused: job.paused,
  };
  if (job.prevState !== null) message.prev_state = job.prevState;
  if (progress.scene_id !== undefined) message.scene_id = progress.scene_id;
  if (job.outcome !== null) message.outcome = job.outcome;
  if (job.error !== null && job.state === "BLOCKED") message.error = job.error as AesError;
  return message;
}

export function registerLive(
  ctx: Pick<AppContext, "db" | "hub" | "now">,
  engine: JobEngine,
  log: FastifyBaseLogger,
): void {
  engine.listen({
    update(job, progress) {
      if (job.deviceId !== null) ctx.hub.send(job.deviceId, jobUpdate(job, progress));
    },
    event(job, event) {
      if (job.deviceId === null) return;
      ctx.hub.send(job.deviceId, {
        type: "job.event",
        job_id: job.id,
        event: { ...event, message: event.message.slice(0, 4000) },
      });
    },
  });

  ctx.hub.onMessage((identity, message) => {
    if (message.type === "hello") {
      void engine
        .activeJob(identity.deviceId)
        .then(async (job) => {
          if (job === null) return;
          ctx.hub.send(identity.deviceId, jobUpdate(job, await engine.progress(job.id)));
        })
        .catch((error: unknown) => log.warn({ err: error }, "aktiv job yuborilmadi"));
      return;
    }
    if (message.type === "log" && message.job_id !== undefined) {
      const jobId = message.job_id;
      void engine
        .get(jobId)
        .then(async (job) => {
          if (job === null || job.deviceId !== identity.deviceId) return;
          await ctx.db.insert(jobEvents).values({
            jobId,
            ts: ctx.now(),
            level: message.level,
            type: "panel.log",
            opId: message.op_id ?? null,
            message: message.message,
            data: message.data ?? null,
          });
        })
        .catch((error: unknown) => log.warn({ err: error }, "panel log yozilmadi"));
    }
  });
}
