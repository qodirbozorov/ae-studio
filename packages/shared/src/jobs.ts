/** Job holat mashinasi holatlari (ae-studio-plan.md §3). */

/** Asosiy zanjir: CHECK → … → DONE. */
export const JOB_FLOW = [
  "CHECK",
  "PLAN",
  "INGEST",
  "AUDIO",
  "PREFLIGHT",
  "BUILD",
  "VERIFY",
  "RENDER",
  "REPORT",
  "DONE",
] as const;

/** Zanjirdan tashqari holatlar: xato (BLOCKED) va panel uzilishi (WAITING_AGENT). */
export const JOB_SIDE_STATES = ["BLOCKED", "WAITING_AGENT"] as const;

export const JOB_STATES = [...JOB_FLOW, ...JOB_SIDE_STATES] as const;

export type JobState = (typeof JOB_STATES)[number];

/** Job qanday yakunlandi (DONE holatida). */
export const JOB_OUTCOMES = ["success", "cancelled", "failed"] as const;
export type JobOutcome = (typeof JOB_OUTCOMES)[number];

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** VERIFY ↔ BUILD patch sikli chegarasi (§2.7). */
export const MAX_PATCHES = 3;

/** Faol bo'lmagan (yakunlangan) holat. */
export const JOB_TERMINAL_STATES = ["DONE"] as const;

/**
 * Job ustidagi amallar (§3): BLOCKED dan chiqish (retry | patch | ask_user | cancel),
 * VERIFY'da qo'lda tasdiq (approve; Faza 3 gacha), Live ekranidan pause/resume.
 */
export const JOB_ACTIONS = [
  "retry",
  "patch",
  "ask_user",
  "cancel",
  "approve",
  "pause",
  "resume",
] as const;
export type JobAction = (typeof JOB_ACTIONS)[number];
