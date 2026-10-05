/**
 * Soxta aerender (testlar): `-output` ga ffmpeg bilan test video yozadi.
 * Davomiylik `AES_FAKE_RENDER_S` (default 2), ffmpeg yo'li `AES_FAKE_FFMPEG`.
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const get = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const out = get("-output");
if (out === undefined || get("-project") === undefined || get("-comp") === undefined) {
  console.error("aerender: -project, -comp, -output kerak");
  process.exit(2);
}
const duration = process.env.AES_FAKE_RENDER_S ?? "2";
const ffmpeg = process.env.AES_FAKE_FFMPEG ?? "ffmpeg";
console.log("PROGRESS:  0:00:00:00 (1): 0 Seconds");
const result = spawnSync(ffmpeg, [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  `testsrc=size=320x240:rate=30:duration=${duration}`,
  "-f",
  "lavfi",
  "-i",
  `sine=frequency=440:duration=${duration}`,
  "-c:v",
  "mpeg4",
  "-c:a",
  "aac",
  "-shortest",
  "-f",
  "mov",
  out,
]);
if (result.status !== 0) console.error(String(result.stderr));
console.log("PROGRESS:  0:00:01:00 (100): 1 Seconds");
process.exit(result.status ?? 1);
