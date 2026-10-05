/**
 * Holat mashinasining sof qismi (§3): zanjir, side-holatlar, amallar qaysi holatda ruxsat etilgani.
 */
import { JOB_FLOW } from "@aes/shared";
import type { JobAction, JobState } from "@aes/shared";

/** Asosiy zanjirdagi keyingi holat (DONE dan keyin yo'q). */
export function nextState(state: JobState): JobState {
  const index = (JOB_FLOW as readonly JobState[]).indexOf(state);
  if (index < 0 || index === JOB_FLOW.length - 1) {
    throw new Error(`${state} dan keyingi holat yo'q`);
  }
  return JOB_FLOW[index + 1]!;
}

/** Panel (AE) kerak bo'ladigan holatlar: panel uzilsa `WAITING_AGENT`. */
export const AGENT_STATES: readonly JobState[] = ["CHECK", "INGEST", "BUILD"];

/** Driver avtomatik bajarmaydigan holatlar: tashqi amal kutiladi. */
export const IDLE_STATES: readonly JobState[] = ["DONE", "BLOCKED", "WAITING_AGENT"];

export function isActive(state: JobState): boolean {
  return state !== "DONE";
}

/** Amal shu holatda mumkinmi (§3: BLOCKED → retry | patch | ask_user | cancel; VERIFY → approve | patch). */
export function actionAllowed(action: JobAction, state: JobState, paused: boolean): boolean {
  switch (action) {
    case "retry":
    case "ask_user":
      return state === "BLOCKED";
    case "patch":
      return state === "BLOCKED" || state === "VERIFY";
    case "approve":
      return state === "VERIFY";
    case "cancel":
      return state !== "DONE" && state !== "REPORT";
    case "pause":
      return isActive(state) && state !== "REPORT" && !paused;
    case "resume":
      return isActive(state) && paused;
  }
}
