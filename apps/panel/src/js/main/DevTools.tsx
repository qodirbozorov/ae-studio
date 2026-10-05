import { makeOp } from "@aes/shared";
import type { Agent } from "../../agent";

const DEV_COMP = "dev.comp";
let seq = 0;

/** Faza 1 sinov tugmalari: oplarni serverdan mustaqil to'g'ridan-to'g'ri AE'ga yuboradi. */
export function DevTools({ agent }: { agent: Agent }) {
  const run = (op: Parameters<typeof agent.runner.submit>[0]) => void agent.runner.submit(op);

  return (
    <section className="dev">
      <h2>Sinov</h2>
      <div className="buttons">
        <button onClick={() => run(makeOp("ping", `dev.ping.${Date.now()}`, seq++, {}))}>
          Ping
        </button>
        <button
          onClick={() =>
            run(
              makeOp("comp.create", DEV_COMP, seq++, {
                name: "AE Studio test",
                w: 1080,
                h: 1920,
                fps: 30,
                dur: 5,
                bg: "#101820",
              }),
            )
          }
        >
          Comp yaratish
        </button>
        <button
          onClick={() =>
            run(
              makeOp("layer.add_text", "dev.title", seq++, {
                comp: DEV_COMP,
                text: "Salom, AE Studio!",
                start: 0,
                style: { size: 96, color: "#FFFFFF", justify: "center" },
                pos: [540, 960],
              }),
            )
          }
        >
          Matn qo'shish
        </button>
      </div>
      <p className="hint">
        Op'lar idempotent: tugmani qayta bossangiz dublikat yaratilmaydi — logda «avvaldan bor».
      </p>
    </section>
  );
}
