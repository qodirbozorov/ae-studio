/**
 * CEP muhiti ustidagi yupqa, tiplangan qatlam (CSInterface o'rniga to'g'ridan-to'g'ri `__adobe_cep__`).
 * Oddiy brauzerda (dev) ham ishlaydi: CEP yo'q bo'lsa funksiyalar xavfsiz natija qaytaradi.
 */

export interface AdobeCep {
  evalScript(script: string, callback?: (result: string) => void): void;
  getSystemPath(pathType: string): string;
  getHostEnvironment(): string;
  addEventListener(type: string, listener: (event: unknown) => void, obj?: unknown): void;
  getExtensionId(): string;
}

export interface CepUtil {
  util: { openURLInDefaultBrowser(url: string): number };
  fs: {
    showOpenDialogEx(
      allowMultiple: boolean,
      chooseDirectory: boolean,
      title: string,
      initialPath: string,
      fileTypes: string[],
      friendlyFilePrefix?: string,
      prompt?: string,
    ): { err: number; data: string[] };
  };
}

export interface CepNode {
  require: (id: string) => unknown;
  process: { version: string; platform: string };
}

declare global {
  interface Window {
    __adobe_cep__?: AdobeCep;
    cep?: CepUtil;
    cep_node?: CepNode;
  }
}

export interface HostEnvironment {
  appName: string;
  appVersion: string;
  appLocale: string;
  appSkinInfo?: {
    panelBackgroundColor?: { color?: { red: number; green: number; blue: number } };
  };
}

/** ExtendScript xatosida CEP qaytaradigan satr. */
export const EVAL_SCRIPT_ERROR = "EvalScript error.";

export function isCep(): boolean {
  return typeof window !== "undefined" && window.__adobe_cep__ !== undefined;
}

function adobe(): AdobeCep {
  const api = window.__adobe_cep__;
  if (api === undefined) throw new Error("CEP muhiti topilmadi");
  return api;
}

/** `evalScript` → Promise. ExtendScript har doim satr qaytaradi. */
export function evalScript(script: string): Promise<string> {
  return new Promise((resolve) => adobe().evalScript(script, (result) => resolve(result)));
}

/** Extension papkasining OS yo'li (`file:///C:/...` → `C:/...`, `file:///Users/...` → `/Users/...`). */
export function extensionPath(): string | null {
  if (!isCep()) return null;
  const raw = decodeURI(adobe().getSystemPath("extension"));
  return /^file:\/\/\/[A-Za-z]:/.test(raw)
    ? raw.slice("file:///".length)
    : raw.replace(/^file:\/\//, "");
}

export function hostEnvironment(): HostEnvironment | null {
  if (!isCep()) return null;
  try {
    return JSON.parse(adobe().getHostEnvironment()) as HostEnvironment;
  } catch {
    return null;
  }
}

export function openUrl(url: string): void {
  if (window.cep !== undefined) window.cep.util.openURLInDefaultBrowser(url);
  else window.open(url, "_blank");
}

/** CEP ichidagi Node `require` (mixed context). CEP tashqarisida `null`. */
export function nodeRequire<T>(id: string): T | null {
  const req = window.cep_node?.require;
  return req === undefined ? null : (req(id) as T);
}

/** AE panel fon rangi (mavzu) — CSS o'zgaruvchisi uchun. */
export function panelBackground(): string | null {
  const color = hostEnvironment()?.appSkinInfo?.panelBackgroundColor?.color;
  if (color === undefined) return null;
  return `rgb(${Math.round(color.red)}, ${Math.round(color.green)}, ${Math.round(color.blue)})`;
}
