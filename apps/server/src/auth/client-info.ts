/**
 * Kirish so'rovi tafsiloti (P9.06): User-Agent'dan qisqa "Chrome · Windows" va Toshkent vaqti.
 * Faqat ko'rsatish uchun — xavfsizlik qarori bunga tayanmaydi (UA soxtalashtirilishi mumkin).
 */

const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/YaBrowser\//, "Yandex"],
  [/Telegram/i, "Telegram"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows/, "Windows"],
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

/** "Chrome · Windows"; noma'lum bo'lsa "Noma'lum brauzer". */
export function describeAgent(userAgent: string | null | undefined): string {
  if (userAgent === null || userAgent === undefined || userAgent.trim() === "") {
    return "Noma'lum brauzer";
  }
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1] ?? "Brauzer";
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  return system === undefined ? browser : `${browser} · ${system}`;
}

/** "12.10.2026, 15:04 (Toshkent)". */
export function tashkentTime(date: Date): string {
  try {
    const text = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
    return `${text} (Toshkent)`;
  } catch {
    return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

/** Saqlash uchun UA (juda uzun sarlavhalar qisqartiriladi). */
export function clipAgent(userAgent: string | undefined): string | null {
  if (userAgent === undefined || userAgent === "") return null;
  return userAgent.slice(0, 400);
}
