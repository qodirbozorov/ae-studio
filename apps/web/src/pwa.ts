/** PWA: service worker (faqat production build'da) va "Ilovani o'rnatish" taklifi. */
import { useEffect, useState } from "react";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function setupPwa(): void {
  // Brauzer o'rnatish taklifini erta yuboradi — React yuklanishidan oldin ushlab qolamiz.
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPrompt;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    });
  }
}

/** O'rnatish mumkin bo'lsa — funksiya, aks holda null. */
export function useInstall(): (() => Promise<void>) | null {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  if (deferred === null) return null;
  return async () => {
    const prompt = deferred;
    if (prompt === null) return;
    await prompt.prompt();
    await prompt.userChoice;
    deferred = null;
    notify();
  };
}

/** Brauzer tarmoq holati. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
