/**
 * Sirlar (§4.4): ElevenLabs kaliti va boshqalar — AES-256-GCM, kalit `MASTER_KEY` (Railway env).
 * Ochiq matn hech qachon log'ga yoki javobga chiqmaydi.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AppContext } from "./context";
import { secrets } from "./db/schema";

export type SecretProvider = "elevenlabs" | "telegram";

export class SecretsError extends Error {}

function masterKey(env: AppContext["env"]): Buffer {
  if (env.MASTER_KEY === undefined) {
    throw new SecretsError("MASTER_KEY sozlanmagan: sirlarni saqlab bo'lmaydi");
  }
  return Buffer.from(env.MASTER_KEY, "base64");
}

export function encrypt(
  key: Buffer,
  plaintext: string,
): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decrypt(
  key: Buffer,
  value: { ciphertext: string; iv: string; tag: string },
): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function saveSecret(
  ctx: Pick<AppContext, "db" | "env" | "now">,
  userId: string,
  provider: SecretProvider,
  plaintext: string,
): Promise<void> {
  const sealed = encrypt(masterKey(ctx.env), plaintext);
  await ctx.db
    .insert(secrets)
    .values({ userId, provider, ...sealed, updatedAt: ctx.now() })
    .onConflictDoUpdate({
      target: [secrets.userId, secrets.provider],
      set: { ...sealed, updatedAt: ctx.now() },
    });
}

export async function readSecret(
  ctx: Pick<AppContext, "db" | "env">,
  userId: string,
  provider: SecretProvider,
): Promise<string | null> {
  const [row] = await ctx.db
    .select()
    .from(secrets)
    .where(and(eq(secrets.userId, userId), eq(secrets.provider, provider)))
    .limit(1);
  if (row === undefined) return null;
  return decrypt(masterKey(ctx.env), row);
}

export async function deleteSecret(
  ctx: Pick<AppContext, "db">,
  userId: string,
  provider: SecretProvider,
): Promise<void> {
  await ctx.db
    .delete(secrets)
    .where(and(eq(secrets.userId, userId), eq(secrets.provider, provider)));
}

/** Kalitning ko'rinadigan qismi: `…abcd`. */
export function maskSecret(value: string): string {
  return `…${value.slice(-4)}`;
}
