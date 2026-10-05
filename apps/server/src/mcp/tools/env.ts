/** Muhit toollari (§8): env_check, devices_list, ae_info. */
import { fail, makeError, makeOp, ok } from "@aes/shared";
import type { AesError } from "@aes/shared";
import { z } from "zod";
import { SERVER_VERSION } from "../../version";
import { defineTool } from "../registry";
import { pickDevice, presentDevice, uuidArg, userDevices } from "./common";

const deviceArg = z.object({
  device_id: uuidArg("device_id")
    .optional()
    .describe("Device id from devices_list; optional when the user has one online device"),
});

export const envTools = [
  defineTool({
    name: "env_check",
    title: "Check environment",
    description:
      "Checks everything a build needs: server, AE panel online, After Effects running, project folder selected in the panel, ffmpeg, active job. Call first. ready=false comes with issues[] (code + hint) to tell the user.",
    input: deviceArg,
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const picked = await pickDevice(ctx, input.device_id);
      if (!picked.ok && picked.error.code !== "ENV_AGENT_OFFLINE") return picked;
      const issues: AesError[] = [];
      const device = picked.ok ? presentDevice(ctx, picked.data) : null;
      // Panel AE holatini hali yubormagan bo'lsa — AE'ni jonli tekshiramiz.
      if (device !== null && device.online && device.ae_version === null) {
        const ping = await ctx.app.hub.run(
          device.id,
          makeOp("ping", `mcp.ping.${Date.now()}`, 0, {}, { timeout_ms: 10_000 }),
          "mcp",
        );
        const version = ping.ok ? ping.data.info?.ae_version : undefined;
        if (typeof version === "string") device.ae_version = version;
      }
      if (device === null || !device.online) {
        issues.push(
          picked.ok
            ? makeError("ENV_AGENT_OFFLINE", `Panel ulanmagan: ${device!.name}`)
            : picked.error,
        );
      } else {
        if (device.ae_version === null) issues.push(makeError("ENV_AE_CLOSED"));
        if (device.project_root === null) issues.push(makeError("ENV_NO_FOLDER"));
        if (device.ffmpeg === false) issues.push(makeError("ENV_FFMPEG_MISSING"));
      }
      const active = device === null ? null : await ctx.engine.activeJob(device.id);
      // ElevenLabs faqat audio kerak bo'lganda talab qilinadi: ready'ga ta'sir qilmaydi, holat ko'rsatiladi.
      const account = await ctx.app.eleven.account(ctx.userId);
      const eleven = {
        configured: account.configured,
        ok: account.configured && account.error === null,
        tier: account.tier,
        remaining_characters: account.remaining,
        error: account.error,
        hint: account.configured
          ? null
          : "Audio (ovoz, musiqa, SFX, subtitr) uchun kabinetda ElevenLabs kalitini kiriting",
      };
      return ok({
        ready: issues.length === 0,
        server: { ok: true, version: SERVER_VERSION },
        device,
        checks: {
          panel: device?.online === true,
          after_effects: device?.ae_version ?? null,
          folder: device?.project_root ?? null,
          ffmpeg: device?.ffmpeg ?? null,
          elevenlabs: eleven,
        },
        active_job: active === null ? null : { id: active.id, state: active.state },
        issues,
      });
    },
  }),

  defineTool({
    name: "devices_list",
    title: "List devices",
    description:
      "Lists the user's connected AE panels (devices) with online status, AE version and open folder.",
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx) {
      const list = await userDevices(ctx);
      return ok(list.map((device) => presentDevice(ctx, device)));
    },
  }),

  defineTool({
    name: "ae_info",
    title: "After Effects info",
    description:
      "Asks After Effects for its version, the open .aep, its compositions and installed font families (fonts=null on AE < 24 with fonts_note). Read-only.",
    input: deviceArg,
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const picked = await pickDevice(ctx, input.device_id);
      if (!picked.ok) return picked;
      if (!ctx.app.hub.isOnline(picked.data.id))
        return fail("ENV_AGENT_OFFLINE", "Panel ulanmagan");
      const res = await ctx.app.hub.run(
        picked.data.id,
        makeOp("info", `mcp.info.${Date.now()}`, 0, {}, { timeout_ms: 20_000 }),
        "mcp",
      );
      if (!res.ok) return res;
      return ok(res.data.info ?? {});
    },
  }),
];
