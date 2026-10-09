/**
 * Panel agenti (CEP ichidagi Node, mixed context). UI uni `agent/agent.cjs` dan `require` qiladi
 * va CEP `evalScript` ni beradi. Agent brauzer API'siga bog'liq emas — Node'da test qilinadi.
 */
import { existsSync, promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeError, makeOp, resolveInsideRoot } from "@aes/shared";
import type { AesError, ServerMessage } from "@aes/shared";
import { createAeBridge } from "./ae-bridge";
import type { AeBridge, EvalScript } from "./ae-bridge";
import { clearCredentials, loadCredentials, saveCredentials } from "./credentials";
import type { Credentials } from "./credentials";
import { FfmpegError, bundledFfmpegDir, checkBinaries, probe, resolveBinaries } from "./ffmpeg";
import { onboardingStep } from "./onboarding";
import { makeContactSheet, waitForFrames } from "./frames";
import type { EnvironmentReport, OnboardingStep } from "./onboarding";
import { TransferError } from "./files";
import { extractAudio } from "./extract";
import { makePreviews } from "./preview";
import { RenderError, findAerender, renderJob } from "./render";
import { uploadFile } from "./files";
import { getJson, postJson } from "./http";
import { scanSource } from "./ingest";
import type { ScannedAsset } from "./ingest";
import { AudioStore } from "./audio-store";
import type { AudioTaskView } from "./audio-store";
import { ClaudeStatusStore, ElevenStatusStore } from "./claude";
import { LiveJobStore } from "./live";
import type { LiveEvent } from "./live";
import { LogStore } from "./log";
import type { TemplateRunInput, TemplateView } from "./templates";
import { createOpRunner } from "./op-runner";
import type { OpRunner } from "./op-runner";
import {
  PairingError,
  agentSocketUrl,
  normalizeServerUrl,
  pollDeviceToken,
  requestDeviceCode,
} from "./pairing";
import type { DeviceCode, PollOptions } from "./pairing";
import { loadSettings, prepareProjectFolder, saveSettings } from "./workspace";
import type { PanelSettings, ProjectInfo } from "./workspace";
import { createWsClient } from "./ws-client";
import type { WsClient } from "./ws-client";

export interface AgentOptions {
  evalScript: EvalScript;
  /** jsx bundle yo'li (`<extension>/jsx/index.js`): yuklanmagan bo'lsa avtomatik `$.evalFile`. */
  jsxPath?: string;
  root?: string;
  /** Credentials papkasi (CEP userData); berilmasa home. */
  dataDir?: string;
  panelVersion?: string;
  /** Testlar uchun: poll kutishini boshqarish. */
  pollOptions?: PollOptions;
}

export interface ServerConnection {
  url: string;
  token: string;
  device: { name: string; os: string };
  panelVersion: string;
}

export interface Pairing {
  /** Panelda ko'rsatiladigan kod. */
  code: Promise<DeviceCode>;
  /** Tasdiqlanib ulanganda tugaydi; rad etilsa/eskirsa `PairingError`. */
  done: Promise<Credentials>;
  cancel(): void;
}

/** Live ekrani tugmalari (P2.12). */
export type PanelJobAction = "pause" | "resume" | "cancel" | "undo";

/** Tarix ekrani (P3.08): shu qurilmadagi job. */
export interface HistoryJob {
  id: string;
  project_name: string;
  state: string;
  outcome: string | null;
  plan_version: number;
  aep_path: string | null;
  created_at: string;
  renders: { id: string; status: string; preset: string; local_path: string }[];
}

export interface Agent {
  log: LogStore;
  /** Aktiv job holati va hodisalari (Live ekrani). */
  live: LiveJobStore;
  /** Live ekranidagi Pause / Resume / Cancel / Undo last. */
  jobAction(action: PanelJobAction): Promise<{ ok: boolean; message?: string }>;
  /** Claude indikatori (serverdan). */
  claude: ClaudeStatusStore;
  /** ElevenLabs indikatori (serverdan). */
  eleven: ElevenStatusStore;
  /** Audio ekrani (P4.12). */
  audio: AudioStore;
  loadAudio(projectId?: string): Promise<AudioTaskView[]>;
  audioAction(
    taskId: string,
    action: "regenerate" | "retry",
  ): Promise<{ ok: boolean; message?: string }>;
  /** Ish papkasidagi faylning to'liq yo'li (Audio ekranida eshitish uchun). */
  absolutePath(relative: string): string | null;
  /** Tarix ekrani: joblar, hisobot, qayta render. */
  history(): Promise<HistoryJob[]>;
  jobReport(jobId: string): Promise<string | null>;
  renderAgain(jobId: string, preset?: string): Promise<{ ok: boolean; message?: string }>;
  /** Shablonlar ekrani (P5.06): galereya, loyiha assetlari, ishga tushirish (Claude'siz). */
  templates(): Promise<TemplateView[]>;
  projectAssets(projectId: string): Promise<{ key: string; kind: string; status: string }[]>;
  runTemplate(
    slug: string,
    input: TemplateRunInput,
  ): Promise<{ ok: boolean; message?: string; job_id?: string }>;
  /** Batch (P5.07): shablon + CSV → N ta video. */
  runBatch(input: {
    project_id: string;
    template: string;
    csv: string;
    format?: string;
    variants?: string[];
    dur?: number;
  }): Promise<{ ok: boolean; message?: string; batch_id?: string; total?: number }>;
  bridge: AeBridge;
  runner: OpRunner;
  getRoot(): string;
  setRoot(root: string): void;
  /** Saqlangan qurilma hisobi (yo'q bo'lsa null). */
  account(): Credentials | null;
  /** Device flow: kod → web'da tasdiq → token saqlanadi → ulanadi. */
  pair(serverUrl: string): Pairing;
  /** Saqlangan token bilan ulanish; hisob yo'q bo'lsa null. */
  connectSaved(): WsClient | null;
  /** Ulanishni uzadi va tokenni o'chiradi. */
  logout(): void;
  /** Ish papkasini tayyorlaydi (ichki papkalar), serverda loyiha sifatida ro'yxatdan o'tkazadi va faollashtiradi. */
  openProject(root: string): Promise<ProjectInfo>;
  /** Shu qurilmaning oxirgi loyihalari (serverdan). */
  recentProjects(): Promise<ProjectInfo[]>;
  currentProject(): ProjectInfo | null;
  /** INGEST: `source/` ni skanerlaydi, thumbnail'larni yuklaydi, serverga `asset.scanned` yuboradi. */
  scanAssets(requestId?: string): Promise<ScannedAsset[]>;
  settings(): PanelSettings;
  /** Birinchi ishga tushirish ustasi (P5.11). */
  onboarding(): OnboardingStep;
  finishOnboarding(): void;
  /** Muhit tekshiruvi: ffmpeg (manbasi bilan), aerender. */
  environment(): Promise<EnvironmentReport>;
  updateSettings(next: Partial<PanelSettings>): PanelSettings;
  /** Past darajali ulanish (testlar). */
  connect(server: ServerConnection): WsClient;
  disconnect(): void;
  connection(): WsClient | null;
}

export function deviceInfo(name?: string | null): { name: string; os: string } {
  return { name: name ?? os.hostname(), os: `${os.type()} ${os.release()}` };
}

export function createAgent(options: AgentOptions): Agent {
  let root = options.root ?? "";
  const dataDir = options.dataDir ?? os.homedir();
  const panelVersion = options.panelVersion ?? "0.0.0";
  const log = new LogStore();
  const live = new LiveJobStore();
  const claude = new ClaudeStatusStore();
  const eleven = new ElevenStatusStore();
  const audioStore = new AudioStore();
  /** Joriy ulanishning HTTP manzili va tokeni (Live tarixi va amallar uchun). */
  let api: { base: string; token: string } | null = null;
  const bridge = createAeBridge({ evalScript: options.evalScript, jsxPath: options.jsxPath });
  const runner = createOpRunner({
    bridge,
    log,
    getRoot: () => root,
    // P6.02: AE `saveFrameToPng` asinxron — kadrlar diskda (AE'ni bloklamasdan) kutiladi.
    afterOp: async (op, result) => {
      if (op.op !== "frames.capture") return null;
      const info = result.info as { pending?: boolean; files?: { path: string }[] } | undefined;
      if (info?.pending !== true) return null;
      return waitForFrames(
        root,
        (info.files ?? []).map((f) => f.path),
      );
    },
  });
  let client: WsClient | null = null;
  let account = loadCredentials(dataDir);
  let settings = loadSettings(dataDir);
  let project: ProjectInfo | null = null;

  function authHeaders(): Record<string, string> {
    if (account === null) throw new Error("Panel serverga ulanmagan");
    return { authorization: `Bearer ${account.token}` };
  }

  let aeVersion: string | null = null;
  /** AE o'rnatilgan papka (ping'dan): aerender shu yerda. */
  let appPath: string | null = null;
  let rendering = false;

  /** Ulangach AE versiyasi va loyiha yo'lini `ping` bilan aniqlab serverga yuboradi. */
  async function reportAeState(target: WsClient): Promise<void> {
    const res = await bridge.runOp(makeOp("ping", "sys.ping", 0, {}, { timeout_ms: 10_000 }), {
      root,
    });
    const info = res.ok ? (res.data.info ?? {}) : {};
    aeVersion = typeof info.ae_version === "string" ? info.ae_version : null;
    appPath = typeof info.app_path === "string" ? info.app_path : appPath;
    const projectPath = typeof info.project_path === "string" ? info.project_path : null;
    const state = {
      ae_version: aeVersion,
      project_path: projectPath,
      project_root: root || null,
      busy: false,
    };
    // AE holati darhol (env_check kutmasin); ffmpeg tekshiruvi (bir necha soniya) keyin alohida.
    target.reportAeState(state);
    void checkBinaries(resolveBinaries(settings.ffmpeg_dir)).then((ffmpeg) => {
      if (target.status() === "connected") target.reportAeState({ ...state, ffmpeg });
    });
  }

  async function uploadThumb(file: string, hash: string): Promise<string | null> {
    if (account === null || project === null) return null;
    const res = await postJson<{ ok: boolean; data?: { url: string; storage_key: string } }>(
      `${account.server_url}/api/agent/projects/${project.id}/uploads`,
      { kind: "thumbs", hash, ext: "jpg" },
      { headers: authHeaders() },
    );
    if (!res.body.ok || res.body.data === undefined) return null;
    await uploadFile(res.body.data.url, file, "image/jpeg");
    return res.body.data.storage_key;
  }

  async function scanAssets(requestId?: string): Promise<ScannedAsset[]> {
    if (project === null || root === "") {
      throw Object.assign(new Error("Ish papkasi tanlanmagan"), {
        aes: makeError("ENV_NO_FOLDER", "Ish papkasi tanlanmagan"),
      });
    }
    log.add({ level: "info", message: "🔎 source/ skanerlanmoqda…" });
    const found = await scanSource({
      root,
      bins: resolveBinaries(settings.ffmpeg_dir),
      uploadThumb,
    });
    const broken = found.filter((a) => a.error !== undefined).length;
    log.add({
      level: broken > 0 ? "warn" : "info",
      message: `📦 ${found.length} ta fayl${broken > 0 ? `, ${broken} tasi xato` : ""}`,
    });
    client?.send({
      type: "asset.scanned",
      ...(requestId !== undefined ? { request_id: requestId } : {}),
      project_root: root,
      assets: found,
    });
    return found;
  }

  async function loadHistory(jobId: string): Promise<void> {
    if (api === null) return;
    const res = await getJson<{ ok: boolean; data?: LiveEvent[] }>(
      `${api.base}/api/agent/jobs/${jobId}/events`,
      { headers: { authorization: `Bearer ${api.token}` } },
    );
    if (res.body.ok && res.body.data !== undefined) live.setHistory(jobId, res.body.data);
  }

  function onJobMessage(message: ServerMessage): void {
    switch (message.type) {
      case "job.update":
        if (live.applyUpdate(message)) {
          loadHistory(message.job_id).catch((error: unknown) =>
            log.add({ level: "warn", message: `Live tarixi yuklanmadi: ${String(error)}` }),
          );
        }
        return;
      case "job.event": {
        live.applyEvent(message);
        // Oplar op-runner'da allaqachon log qilinadi; qolgan job hodisalari umumiy log'ga ham.
        const event = message.event;
        if (!event.type.startsWith("op.") && event.level !== "debug") {
          log.add({
            level: event.level,
            message: event.message,
            job_id: message.job_id,
            ...(event.op_id === undefined ? {} : { op_id: event.op_id }),
          });
        }
        return;
      }
      case "job.pause":
        log.add({ level: "info", message: "⏸ Pauza: joriy op tugagach to'xtaydi" });
        return;
      case "claude.status":
        claude.set({ linked: message.linked, last_seen_at: message.last_seen_at });
        return;
      case "audio.update":
        audioStore.upsert(message.task);
        return;
      case "elevenlabs.status":
        eleven.set({
          configured: message.configured,
          ok: message.ok,
          remaining: message.remaining,
        });
        return;
      case "job.cancel":
        log.add({ level: "warn", message: "⏹ Job bekor qilindi" });
        return;
      default:
        return;
    }
  }

  function connect(server: ServerConnection): WsClient {
    client?.stop();
    api = {
      base: server.url.replace(/^ws/, "http").replace(/\/ws\/agent$/, ""),
      token: server.token,
    };
    const next = createWsClient({
      ...server,
      runner,
      log,
      getRoot: () => root,
      aeVersion: () => aeVersion,
      probeDuration: async (file) =>
        (await probe(resolveBinaries(settings.ffmpeg_dir), file)).duration,
    });
    client = next;
    next.onMessage(onJobMessage);
    next.onMessage((message) => {
      if (message.type !== "render.request") return;
      if (rendering || root === "") {
        next.send({
          type: "request.failed",
          request_id: message.request_id,
          error:
            root === ""
              ? makeError("ENV_NO_FOLDER", "Ish papkasi tanlanmagan")
              : makeError("RENDER_FAILED", "Boshqa render ketmoqda"),
        });
        return;
      }
      rendering = true;
      renderJob(
        {
          root,
          bins: resolveBinaries(settings.ffmpeg_dir),
          bridge,
          log,
          aerenderPath: settings.aerender_path,
          appPath,
          omTemplate: settings.render_om_template,
        },
        message,
      )
        .then((result) =>
          next.send({ type: "render.done", request_id: message.request_id, ...result }),
        )
        .catch((error: unknown) => {
          const aes =
            error instanceof RenderError || error instanceof FfmpegError
              ? error.error
              : makeError("RENDER_FAILED", error instanceof Error ? error.message : String(error));
          log.add({ level: "error", message: `❌ Render: ${aes.code} ${aes.message ?? ""}` });
          next.send({ type: "request.failed", request_id: message.request_id, error: aes });
        })
        .finally(() => {
          rendering = false;
        });
    });
    next.onMessage((message) => {
      if (message.type !== "frames.sheet.request") return;
      const fail = (error: ReturnType<typeof makeError>) =>
        next.send({ type: "request.failed", request_id: message.request_id, error });
      if (root === "") {
        fail(makeError("ENV_NO_FOLDER", "Ish papkasi tanlanmagan"));
        return;
      }
      void (async () => {
        let tmp: string | null = null;
        try {
          const sheet = await makeContactSheet(root, resolveBinaries(settings.ffmpeg_dir), message);
          tmp = sheet.tmp;
          if (message.save_as !== undefined) {
            const target = resolveInsideRoot(root, message.save_as);
            if (target.ok && !existsSync(target.data)) {
              await fsp.mkdir(path.dirname(target.data), { recursive: true });
              await fsp.copyFile(sheet.file, target.data);
            }
          }
          const uploaded = await uploadFile(message.upload.url, sheet.file, "image/jpeg");
          next.send({
            type: "file.uploaded",
            request_id: message.request_id,
            storage_key: message.upload.storage_key,
            ...uploaded,
          });
        } catch (error) {
          fail(
            error instanceof FfmpegError || error instanceof TransferError
              ? error.error
              : makeError(
                  "FRAME_CAPTURE_FAILED",
                  error instanceof Error ? error.message : String(error),
                  {
                    reason: "render_error",
                  },
                ),
          );
        } finally {
          if (tmp !== null)
            await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
        }
      })();
    });
    next.onMessage((message) => {
      if (message.type !== "file.upload.request") return;
      const fail = (error: ReturnType<typeof makeError>) =>
        next.send({ type: "request.failed", request_id: message.request_id, error });
      if (root === "") {
        fail(makeError("ENV_NO_FOLDER", "Ish papkasi tanlanmagan"));
        return;
      }
      const file = resolveInsideRoot(root, message.local_path);
      if (!file.ok) {
        fail(file.error);
        return;
      }
      log.add({ level: "info", message: `⬆️ Yuklanmoqda: ${message.local_path}` });
      uploadFile(message.upload.url, file.data, message.content_type)
        .then((res) =>
          next.send({
            type: "file.uploaded",
            request_id: message.request_id,
            storage_key: message.upload.storage_key,
            ...res,
          }),
        )
        .catch((error: unknown) => {
          const missing = (error as { code?: string }).code === "ENOENT";
          fail(
            error instanceof TransferError
              ? error.error
              : makeError(
                  missing ? "ASSET_MISSING" : "SYS_INTERNAL",
                  missing
                    ? `${message.local_path} topilmadi`
                    : error instanceof Error
                      ? error.message
                      : String(error),
                ),
          );
        });
    });
    next.onMessage((message) => {
      if (message.type !== "audio.extract.request") return;
      if (root === "") {
        next.send({
          type: "request.failed",
          request_id: message.request_id,
          error: makeError("ENV_NO_FOLDER", "Ish papkasi tanlanmagan"),
        });
        return;
      }
      log.add({ level: "info", message: `🎧 Ovoz ajratilmoqda: ${message.local_path}` });
      extractAudio(root, resolveBinaries(settings.ffmpeg_dir), message)
        .then((res) => next.send({ type: "file.uploaded", request_id: message.request_id, ...res }))
        .catch((error: unknown) => {
          const aes =
            error instanceof FfmpegError || error instanceof TransferError
              ? error.error
              : makeError("SYS_INTERNAL", error instanceof Error ? error.message : String(error));
          log.add({ level: "warn", message: `🎧 ${message.local_path}: ${aes.code}` });
          next.send({ type: "request.failed", request_id: message.request_id, error: aes });
        });
    });
    next.onMessage((message) => {
      if (message.type !== "asset.preview.request") return;
      if (root === "") {
        next.send({
          type: "request.failed",
          request_id: message.request_id,
          error: makeError("ENV_NO_FOLDER", "Ish papkasi tanlanmagan"),
        });
        return;
      }
      makePreviews(root, resolveBinaries(settings.ffmpeg_dir), message)
        .then((files) =>
          next.send({ type: "asset.preview.ready", request_id: message.request_id, files }),
        )
        .catch((error: unknown) => {
          const aes =
            error instanceof FfmpegError || error instanceof TransferError
              ? error.error
              : makeError("SYS_INTERNAL", error instanceof Error ? error.message : String(error));
          log.add({ level: "warn", message: `🖼 ${message.local_path}: ${aes.code}` });
          next.send({ type: "request.failed", request_id: message.request_id, error: aes });
        });
    });
    next.onMessage((message) => {
      if (message.type !== "project.open") return;
      agent
        .openProject(message.root_path)
        .then((opened) =>
          next.send({
            type: "project.opened",
            request_id: message.request_id,
            project: { id: opened.id, name: opened.name, root_path: opened.root_path },
          }),
        )
        .catch((error: unknown) =>
          next.send({
            type: "request.failed",
            request_id: message.request_id,
            error: makeError(
              "ENV_NO_FOLDER",
              error instanceof Error ? error.message : String(error),
            ),
          }),
        );
    });
    next.onMessage((message) => {
      if (message.type !== "assets.scan") return;
      if (message.project_root !== root) {
        next.send({
          type: "request.failed",
          request_id: message.request_id,
          error: makeError("ENV_NO_FOLDER", `Panelda boshqa papka ochiq: ${root || "(yo'q)"}`),
        });
        return;
      }
      scanAssets(message.request_id).catch((error: unknown) => {
        const aes =
          (error as { aes?: AesError; error?: AesError }).aes ??
          (error as { error?: AesError }).error;
        next.send({
          type: "request.failed",
          request_id: message.request_id,
          error:
            aes ??
            makeError("SYS_INTERNAL", error instanceof Error ? error.message : String(error)),
        });
      });
    });
    next.onStatus((status) => {
      if (status === "connected") void reportAeState(next);
      // #6: AE qayta ochilgan — oxirgi ish papkasi avtomatik tiklanadi.
      if (status === "connected" && root === "" && settings.last_project_root !== null) {
        const last = settings.last_project_root;
        void agent
          .openProject(last)
          .then(() => log.add({ level: "info", message: `♻️ Ish papkasi tiklandi: ${last}` }))
          .catch((error: unknown) =>
            log.add({
              level: "warn",
              message: `Oxirgi ish papkasi tiklanmadi (${last}): ${error instanceof Error ? error.message : String(error)}`,
            }),
          );
      }
      if (status === "unauthorized" && account !== null && server.token === account.token) {
        log.add({ level: "warn", message: "Qurilma bekor qilingan — panelni qayta ulang" });
        clearCredentials(dataDir);
        account = null;
      }
    });
    next.start();
    return next;
  }

  function connectWith(credentials: Credentials): WsClient {
    return connect({
      url: agentSocketUrl(credentials.server_url),
      token: credentials.token,
      device: deviceInfo(settings.device_name),
      panelVersion,
    });
  }

  const authed = () => {
    if (api === null) throw new Error("Panel serverga ulanmagan");
    return { base: api.base, headers: { authorization: `Bearer ${api.token}` } };
  };

  const agent: Agent = {
    log,
    live,
    claude,
    eleven,
    audio: audioStore,
    async loadAudio(projectId) {
      const { base, headers } = authed();
      const query = projectId === undefined ? "" : `?project_id=${encodeURIComponent(projectId)}`;
      const res = await getJson<{ ok: boolean; data?: AudioTaskView[] }>(
        `${base}/api/agent/audio${query}`,
        {
          headers,
        },
      );
      const list = res.body.ok ? (res.body.data ?? []) : [];
      audioStore.replace(list);
      return list;
    },
    async audioAction(taskId, action) {
      const { base, headers } = authed();
      const res = await postJson<{
        ok: boolean;
        data?: AudioTaskView;
        error?: { message?: string; hint?: string };
      }>(`${base}/api/agent/audio/${taskId}/${action}`, {}, { headers });
      if (res.body.ok && res.body.data !== undefined) {
        audioStore.upsert(res.body.data);
        return { ok: true };
      }
      return {
        ok: false,
        message: res.body.error?.message ?? res.body.error?.hint ?? `HTTP ${res.status}`,
      };
    },
    absolutePath(relative) {
      if (root === "") return null;
      return `${root.replace(/\\/g, "/").replace(/\/+$/, "")}/${relative}`;
    },
    async history() {
      const { base, headers } = authed();
      const res = await getJson<{ ok: boolean; data?: HistoryJob[] }>(`${base}/api/agent/jobs`, {
        headers,
      });
      return res.body.ok ? (res.body.data ?? []) : [];
    },
    async jobReport(jobId) {
      const { base, headers } = authed();
      const res = await getJson<{ ok: boolean; data?: { markdown: string } }>(
        `${base}/api/agent/jobs/${jobId}/report`,
        { headers },
      );
      return res.body.ok ? (res.body.data?.markdown ?? null) : null;
    },
    onboarding() {
      return onboardingStep({
        paired: account !== null,
        project: project !== null,
        onboarded: settings.onboarded,
      });
    },
    finishOnboarding() {
      settings = { ...settings, onboarded: true };
      saveSettings(dataDir, settings);
    },
    async environment() {
      const ffmpeg = await checkBinaries(resolveBinaries(settings.ffmpeg_dir));
      const aerender = findAerender(settings.aerender_path, appPath);
      return {
        ffmpeg,
        ffmpeg_source:
          settings.ffmpeg_dir !== null
            ? "settings"
            : bundledFfmpegDir() !== null
              ? "bundled"
              : "path",
        aerender: aerender !== null,
        aerender_path: aerender,
        node: process.version,
      };
    },
    async templates() {
      const { base, headers } = authed();
      const res = await getJson<{ ok: boolean; data?: TemplateView[] }>(
        `${base}/api/agent/templates`,
        { headers },
      );
      return res.body.ok ? (res.body.data ?? []) : [];
    },
    async projectAssets(projectId) {
      const { base, headers } = authed();
      const res = await getJson<{
        ok: boolean;
        data?: { key: string; kind: string; status: string }[];
      }>(`${base}/api/agent/projects/${encodeURIComponent(projectId)}/assets`, { headers });
      return res.body.ok ? (res.body.data ?? []) : [];
    },
    async runTemplate(slug, input) {
      const { base, headers } = authed();
      const res = await postJson<{
        ok: boolean;
        data?: { job_id: string };
        error?: { message?: string; hint?: string };
      }>(`${base}/api/agent/templates/${encodeURIComponent(slug)}/run`, input, { headers });
      if (res.body.ok && res.body.data !== undefined) {
        log.add({ level: "info", message: `🧩 Shablon ishga tushdi: ${slug}` });
        return { ok: true, job_id: res.body.data.job_id };
      }
      return {
        ok: false,
        message: res.body.error?.message ?? res.body.error?.hint ?? `HTTP ${res.status}`,
      };
    },
    async runBatch(input) {
      const { base, headers } = authed();
      const res = await postJson<{
        ok: boolean;
        data?: { id: string; total: number };
        error?: { message?: string; hint?: string };
      }>(`${base}/api/agent/batches`, input, { headers });
      if (res.body.ok && res.body.data !== undefined) {
        log.add({ level: "info", message: `🧩 Batch: ${res.body.data.total} ta video navbatda` });
        return { ok: true, batch_id: res.body.data.id, total: res.body.data.total };
      }
      return {
        ok: false,
        message: res.body.error?.message ?? res.body.error?.hint ?? `HTTP ${res.status}`,
      };
    },
    async renderAgain(jobId, preset) {
      const { base, headers } = authed();
      const res = await postJson<{ ok: boolean; error?: { message?: string; hint?: string } }>(
        `${base}/api/agent/jobs/${jobId}/render`,
        preset === undefined ? {} : { preset },
        { headers },
      );
      if (res.body.ok) return { ok: true };
      return {
        ok: false,
        message: res.body.error?.message ?? res.body.error?.hint ?? `HTTP ${res.status}`,
      };
    },
    async jobAction(action) {
      const job = live.current();
      if (api === null || job === null) return { ok: false, message: "Aktiv job yo'q" };
      const res = await postJson<{ ok: boolean; error?: { message?: string; hint?: string } }>(
        `${api.base}/api/agent/jobs/${job.id}/actions`,
        { action },
        { headers: { authorization: `Bearer ${api.token}` } },
      );
      if (res.body.ok) return { ok: true };
      const message = res.body.error?.message ?? res.body.error?.hint ?? `HTTP ${res.status}`;
      log.add({ level: "warn", message: `${action}: ${message}` });
      return { ok: false, message };
    },
    bridge,
    runner,
    getRoot: () => root,
    setRoot(next) {
      root = next;
    },
    account: () => account,
    pair(serverUrl) {
      const signal = { cancelled: false };
      const base = normalizeServerUrl(serverUrl);
      const code = requestDeviceCode(base, deviceInfo(settings.device_name));
      const done = code.then(async (deviceCode) => {
        log.add({
          level: "info",
          message: `🔑 Kod: ${deviceCode.user_code} — web kabinetda tasdiqlang`,
        });
        const grant = await pollDeviceToken(base, deviceCode, { ...options.pollOptions, signal });
        const credentials: Credentials = {
          server_url: base,
          device_id: grant.device_id,
          token: grant.access_token,
        };
        saveCredentials(dataDir, credentials);
        account = credentials;
        log.add({ level: "info", message: "✅ Qurilma ulandi" });
        connectWith(credentials);
        return credentials;
      });
      done.catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log.add({ level: "error", message: `❌ Ulanish: ${message}` });
      });
      return {
        code,
        done,
        cancel() {
          signal.cancelled = true;
        },
      };
    },
    connectSaved() {
      return account === null ? null : connectWith(account);
    },
    logout() {
      client?.stop();
      client = null;
      clearCredentials(dataDir);
      account = null;
    },
    async openProject(folder) {
      const prepared = prepareProjectFolder(folder);
      const res = await postJson<{ ok: boolean; data?: ProjectInfo; error?: { message?: string } }>(
        `${account?.server_url ?? ""}/api/agent/projects`,
        { root_path: prepared },
        { headers: authHeaders() },
      );
      if (!res.body.ok || res.body.data === undefined) {
        throw new Error(
          res.body.error?.message ?? `Loyiha ro'yxatdan o'tmadi (HTTP ${res.status})`,
        );
      }
      project = res.body.data;
      root = prepared;
      if (settings.last_project_root !== prepared) {
        settings = { ...settings, last_project_root: prepared };
        saveSettings(dataDir, settings);
      }
      log.add({ level: "info", message: `📁 Ish papkasi: ${prepared}` });
      // Server (CHECK, env_check) yangi papkani `project.opened` javobidan oldin bilsin.
      if (client !== null && client.status() === "connected") {
        await reportAeState(client).catch(() => undefined);
      }
      return project;
    },
    async recentProjects() {
      if (account === null) return [];
      const res = await getJson<{ ok: boolean; data?: ProjectInfo[] }>(
        `${account.server_url}/api/agent/projects`,
        { headers: authHeaders() },
      );
      return res.body.ok ? (res.body.data ?? []) : [];
    },
    currentProject: () => project,
    scanAssets,
    settings: () => settings,
    updateSettings(next) {
      settings = { ...settings, ...next };
      saveSettings(dataDir, settings);
      return settings;
    },
    connect,
    disconnect() {
      client?.stop();
      client = null;
    },
    connection: () => client,
  };
  return agent;
}

export { PairingError };
export type { Credentials } from "./credentials";
export type { EvalScript } from "./ae-bridge";
export type { AudioTaskView } from "./audio-store";
export type { ClaudeIndicator, ClaudeStatus } from "./claude";
export { claudeIndicator } from "./claude";
export type { LiveEvent, LiveJob } from "./live";
export type { LogEntry } from "./log";
export type { OpOutcome, RunnerEvent } from "./op-runner";
export type { DeviceCode } from "./pairing";
export type { PanelSettings, ProjectInfo } from "./workspace";
export type { ScannedAsset } from "./ingest";
export type { ConnectionStatus, WsClient } from "./ws-client";
