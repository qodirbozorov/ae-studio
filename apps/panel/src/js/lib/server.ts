/**
 * Panel ulanadigan server. Build vaqtida beriladi: `VITE_AES_SERVER_URL=https://… pnpm zxp`.
 * Domen o'zgarsa — shu o'zgaruvchi bilan qayta build qilinadi (foydalanuvchi manzil kiritmaydi).
 */
export const SERVER_URL: string = (
  (import.meta.env.VITE_AES_SERVER_URL as string | undefined) ??
  "https://server-production-9c75.up.railway.app"
).replace(/\/+$/, "");
