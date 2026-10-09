// @include './lib/json2.js'
/**
 * ExtendScript (ES3) kirish nuqtasi. Panel uni `$.evalFile` bilan yuklaydi va
 * `$[NS].runOp(json)` orqali chaqiradi. Bu faylda runtime `export` bo'lmasligi kerak (ES3).
 */
import { JSX_VERSION, NS } from "../shared/constants";
import { runBatch, runOp } from "./dispatcher";
import { AES } from "./lib/runtime";

const host = $ as unknown as { [key: string]: unknown; global?: { [key: string]: unknown } };

host[NS] = {
  version: JSX_VERSION,
  runOp: runOp,
  runBatch: runBatch,
  AES: AES,
};
// Sahna dasturlari (P6.04) global `AES` ni chaqiradi (update-technicalguidline §3.2).
if (typeof host.global === "object" && host.global !== null) host.global.AES = AES;
