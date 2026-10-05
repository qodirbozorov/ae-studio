export class TimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`${ms} ms ichida javob bo'lmadi`);
    this.name = "TimeoutError";
  }
}

/** Har chaqiruvda timeout (§2.3). */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
