/**
 * Fayl uzatish (§6): pre-signed URL'lar orqali upload/download, sha256 tekshiruvi bilan.
 * Yuklab olingan fayl sha256 mos kelmasa 3 marta qayta yuklanadi, keyin `ASSET_CORRUPT` (§6).
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, promises as fsp } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { makeError } from "@aes/shared";
import type { AesError } from "@aes/shared";

export const DOWNLOAD_ATTEMPTS = 3;
const TIMEOUT_MS = 10 * 60 * 1000;

export async function sha256File(file: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { sha256: hash.digest("hex"), size };
}

function clientFor(url: URL) {
  return url.protocol === "https:" ? https : http;
}

/** GET → faylga (oqim). HTTP 2xx bo'lmasa xato. */
function getToFile(url: string, file: string): Promise<void> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = clientFor(target).get(target, { timeout: TIMEOUT_MS }, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Yuklab olish: HTTP ${status}`));
        return;
      }
      pipeline(response, createWriteStream(file)).then(resolve, reject);
    });
    request.on("timeout", () => request.destroy(new Error("Yuklab olish: timeout")));
    request.on("error", reject);
  });
}

export class TransferError extends Error {
  constructor(readonly error: AesError) {
    super(error.message ?? error.code);
    this.name = "TransferError";
  }
}

/**
 * Yuklab oladi va sha256 ni tekshiradi; mos kelmasa qayta urinadi. Fayl avval vaqtinchalik nom bilan
 * yoziladi — buzilgan fayl hech qachon `dest` da qolmaydi.
 */
export async function downloadVerified(
  url: string,
  dest: string,
  sha256: string,
  attempts = DOWNLOAD_ATTEMPTS,
): Promise<{ sha256: string; size: number }> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  let lastProblem = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const temp = `${dest}.${randomBytes(4).toString("hex")}.part`;
    try {
      await getToFile(url, temp);
      const actual = await sha256File(temp);
      if (actual.sha256 === sha256) {
        await fsp.rename(temp, dest);
        return actual;
      }
      lastProblem = `sha256 mos emas (${attempt}-urinish)`;
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }
    await fsp.rm(temp, { force: true });
  }
  throw new TransferError(
    makeError(
      "ASSET_CORRUPT",
      `${path.basename(dest)}: ${attempts} urinishdan keyin ham — ${lastProblem}`,
    ),
  );
}

/** Faylni PUT bilan yuklaydi (oqim); natijada sha256 va hajm. */
export async function uploadFile(
  url: string,
  file: string,
  contentType = "application/octet-stream",
): Promise<{ sha256: string; size: number }> {
  const info = await sha256File(file);
  const target = new URL(url);
  await new Promise<void>((resolve, reject) => {
    const request = clientFor(target).request(
      target,
      {
        method: "PUT",
        headers: { "content-type": contentType, "content-length": info.size },
        timeout: TIMEOUT_MS,
      },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve();
        else reject(new TransferError(makeError("SYS_INTERNAL", `Yuklash: HTTP ${status}`)));
      },
    );
    request.on("timeout", () => request.destroy(new Error("Yuklash: timeout")));
    request.on("error", reject);
    createReadStream(file).pipe(request);
  });
  return info;
}
