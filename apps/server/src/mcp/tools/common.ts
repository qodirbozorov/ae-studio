/** Toollar uchun umumiy yordamchilar: qurilma tanlash, loyiha egaligi. */
import { fail, ok } from "@aes/shared";
import type { Result } from "@aes/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { devices, projects } from "../../db/schema";
import type { ToolContext } from "../registry";

export type DeviceRow = typeof devices.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;

export const uuidArg = (what: string) => z.uuid({ error: `${what} — UUID` });

export function presentDevice(ctx: ToolContext, device: DeviceRow) {
  const state = ctx.app.hub.state(device.id);
  return {
    id: device.id,
    name: device.name,
    os: device.os,
    online: state !== null,
    ae_version: state?.aeVersion ?? device.aeVersion,
    project_root: state?.projectRoot ?? null,
    ae_project: state?.projectPath ?? null,
    ffmpeg: state?.ffmpeg ?? null,
    last_seen_at: device.lastSeenAt,
  };
}

export async function userDevices(ctx: ToolContext): Promise<DeviceRow[]> {
  return ctx.app.db
    .select()
    .from(devices)
    .where(and(eq(devices.userId, ctx.userId), isNull(devices.revokedAt)))
    .orderBy(desc(devices.lastSeenAt));
}

/**
 * Qurilma: berilgan id (egasi tekshiriladi) yoki yagona online / yagona qurilma.
 * Bir nechta bo'lsa — `device_id` so'raladi.
 */
export async function pickDevice(ctx: ToolContext, deviceId?: string): Promise<Result<DeviceRow>> {
  const list = await userDevices(ctx);
  if (deviceId !== undefined) {
    const found = list.find((device) => device.id === deviceId);
    return found === undefined ? fail("SYS_NOT_FOUND", "Qurilma topilmadi") : ok(found);
  }
  if (list.length === 0) {
    return fail(
      "ENV_AGENT_OFFLINE",
      "Ulangan qurilma yo'q: After Effects'da AE Studio panelini oching va kabinetdagi kod bilan ulang",
    );
  }
  const online = list.filter((device) => ctx.app.hub.isOnline(device.id));
  if (online.length === 1) return ok(online[0]!);
  if (online.length === 0 && list.length === 1) return ok(list[0]!);
  return fail("SYS_BAD_REQUEST", "Bir nechta qurilma bor: device_id ni bering (devices_list)", {
    devices: list.map((device) => ({
      id: device.id,
      name: device.name,
      online: ctx.app.hub.isOnline(device.id),
    })),
  });
}

/** Faqat shu userning loyihasi. */
export async function ownProject(ctx: ToolContext, projectId: string): Promise<Result<ProjectRow>> {
  const [row] = await ctx.app.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, ctx.userId)))
    .limit(1);
  return row === undefined ? fail("SYS_NOT_FOUND", "Loyiha topilmadi (project_list)") : ok(row);
}

/** Loyiha qurilmasi online bo'lishi kerak bo'lgan toollar uchun. */
export function requireOnline(ctx: ToolContext, project: ProjectRow): Result<string> {
  if (project.deviceId === null)
    return fail("AUTH_DEVICE_REVOKED", "Loyiha qurilmasi bekor qilingan");
  if (!ctx.app.hub.isOnline(project.deviceId)) {
    return fail("ENV_AGENT_OFFLINE", "Loyiha qurilmasida panel ulanmagan");
  }
  return ok(project.deviceId);
}
