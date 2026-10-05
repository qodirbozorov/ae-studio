/**
 * Qurilma tokeni lokal saqlanadi (§4.2.5): `<dataDir>/.aestudio/credentials`, AES-256-GCM.
 * Kalit mashinaga bog'liq (hostname + OS foydalanuvchisi + home), scrypt bilan; native modul yo'q (D9).
 * Fayl boshqa kompyuterga ko'chirilsa ochilmaydi.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Credentials {
  server_url: string;
  device_id: string;
  token: string;
}

interface StoredFile {
  v: 1;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

export function machineSecret(): string {
  let user = "";
  try {
    user = os.userInfo().username;
  } catch {
    user = process.env.USERNAME ?? process.env.USER ?? "";
  }
  return [os.hostname(), user, os.homedir(), process.platform].join("|");
}

export function credentialsPath(dataDir: string): string {
  return path.join(dataDir, ".aestudio", "credentials");
}

export function encryptCredentials(credentials: Credentials, secret: string): StoredFile {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(secret, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return {
    v: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

/** Ochib bo'lmasa (boshqa mashina, buzilgan fayl) null. */
export function decryptCredentials(stored: StoredFile, secret: string): Credentials | null {
  try {
    const key = scryptSync(secret, Buffer.from(stored.salt, "base64"), 32);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(stored.iv, "base64"));
    decipher.setAuthTag(Buffer.from(stored.tag, "base64"));
    const text = Buffer.concat([
      decipher.update(Buffer.from(stored.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const value = JSON.parse(text) as Partial<Credentials>;
    if (
      typeof value.server_url !== "string" ||
      typeof value.device_id !== "string" ||
      typeof value.token !== "string"
    ) {
      return null;
    }
    return { server_url: value.server_url, device_id: value.device_id, token: value.token };
  } catch {
    return null;
  }
}

export function saveCredentials(
  dataDir: string,
  credentials: Credentials,
  secret = machineSecret(),
): void {
  const file = credentialsPath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(encryptCredentials(credentials, secret)), { mode: 0o600 });
}

export function loadCredentials(dataDir: string, secret = machineSecret()): Credentials | null {
  try {
    const stored = JSON.parse(fs.readFileSync(credentialsPath(dataDir), "utf8")) as StoredFile;
    return stored.v === 1 ? decryptCredentials(stored, secret) : null;
  } catch {
    return null;
  }
}

export function clearCredentials(dataDir: string): void {
  try {
    fs.unlinkSync(credentialsPath(dataDir));
  } catch {
    // yo'q bo'lsa — hech narsa
  }
}
