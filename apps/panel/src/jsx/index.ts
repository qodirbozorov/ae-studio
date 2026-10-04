// @include './lib/json2.js'
/**
 * ExtendScript (ES3) kirish nuqtasi. Panel uni `$.evalFile` bilan yuklaydi va
 * `$[NS].runOp(json)` orqali chaqiradi. Bu faylda runtime `export` bo'lmasligi kerak (ES3).
 */
import { JSX_VERSION, NS } from "../shared/constants";
import { runOp } from "./dispatcher";

const host = $ as unknown as { [key: string]: unknown };

host[NS] = {
  version: JSX_VERSION,
  runOp: runOp,
};
