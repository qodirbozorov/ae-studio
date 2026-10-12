/**
 * Muhit o'zgaruvchilari (ae-studio-plan.md §13 "Railway env").
 * Keyingi fazalarda kerak bo'ladiganlari hozircha ixtiyoriy; berilsa formati tekshiriladi.
 */
import { z } from "zod";

const base64Key32 = z.string().refine((value) => Buffer.from(value, "base64").length === 32, {
  error: "32 baytli base64 kalit bo'lishi kerak (openssl rand -base64 32)",
});

const optionalString = z.string().min(1).optional();

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default("0.0.0.0"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, { error: "postgres:// yoki postgresql:// URL kerak" }),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, { error: "redis:// yoki rediss:// URL kerak" }),
    /** Tashqi manzil (OAuth, MCP, presigned havolalar uchun). Production'da majburiy. */
    PUBLIC_URL: z.url().optional(),

    // Faza 2–4 da majburiy bo'ladi
    MASTER_KEY: base64Key32.optional(),
    JWT_SIGNING_KEY: z.string().min(32).optional(),
    S3_ENDPOINT: z.url().optional(),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY: optionalString,
    S3_SECRET_KEY: optionalString,
    /** Faqat dev uchun. */
    ELEVENLABS_DEFAULT_KEY: optionalString,
    /** ElevenLabs API manzili (default https://api.elevenlabs.io; testlarda soxta server). */
    ELEVENLABS_BASE_URL: z.url().optional(),

    /** Telegram bot (BotFather): kabinetga kirish (deep link) va xabarnomalar; bot nomi deep link uchun. */
    TELEGRAM_BOT_TOKEN: optionalString,
    TELEGRAM_BOT_USERNAME: optionalString,
    /** Telegram Bot API manzili (default https://api.telegram.org; testlarda soxta). */
    TELEGRAM_API_URL: z.url().optional(),

    /** Production xizmat ko'rsatish (P5.13): backup oralig'i (soat, 0 — o'chiq), nechta saqlanadi, loglar muddati. */
    BACKUP_INTERVAL_H: z.coerce
      .number()
      .min(0)
      .max(24 * 30)
      .default(24),
    BACKUP_KEEP: z.coerce.number().int().min(1).max(365).default(14),
    LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),

    /** Lokal storage drayveri papkasi (S3 berilmaganda). */
    STORAGE_DIR: optionalString,

    /**
     * Jarayon roli (P8.03): `all` — hammasi bitta serverda (sukut); `api` — server audio vazifalarini
     * bajarmaydi, faqat navbatga qo'yadi va natijani kuzatib panelga yetkazadi; `worker` — faqat audio
     * vazifalari (HTTP faqat /health). `api`/`worker` umumiy storage (R2) bilan ishlaydi.
     */
    AES_ROLE: z.enum(["all", "api", "worker"]).default("all"),
    /** Bitta jarayonda bir vaqtda bajariladigan audio vazifalar soni. */
    AUDIO_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),

    /** `/admin` kirishi (login va parol). Berilmasa admin panel o'chiq. */
    ADMIN_LOGIN: optionalString,
    ADMIN_PASSWORD: z.string().min(12).optional(),

    /**
     * Balans cheklovi (Faza 8): `1` — faollashtirilmagan yoki balansi yetmagan foydalanuvchi pullik amal
     * boshlay olmaydi. Berilmasa sarf faqat yoziladi (admin panel tayyor bo'lguncha).
     */
    BILLING_ENFORCE: z
      .enum(["0", "1", "true", "false"])
      .optional()
      .transform((value) => value === "1" || value === "true"),

    /** Web kabinet build papkasi; berilmasa `apps/web/dist` avtomatik qidiriladi. */
    WEB_DIST: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.PUBLIC_URL === undefined) {
      ctx.addIssue({ code: "custom", path: ["PUBLIC_URL"], message: "Production'da majburiy" });
    }
  });

export type Env = z.output<typeof envSchema> & { PUBLIC_URL: string };

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super("Muhit o'zgaruvchilari noto'g'ri:\n  - " + problems.join("\n  - "));
    this.name = "EnvError";
  }
}

/** Env'ni tekshiradi. Xato xabarida qiymatlar emas, faqat o'zgaruvchi nomlari chiqadi (maxfiylik). */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source, { error: z.locales.uz().localeError });
  if (!parsed.success) {
    throw new EnvError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(env)"}: ${issue.message}`),
    );
  }
  const env = parsed.data;
  return { ...env, PUBLIC_URL: env.PUBLIC_URL ?? `http://localhost:${env.PORT}` };
}
