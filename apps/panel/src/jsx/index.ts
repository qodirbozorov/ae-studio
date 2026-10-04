// @include './lib/json2.js'
/**
 * ExtendScript (ES3) kirish nuqtasi. Panel uni `$.evalFile` bilan yuklaydi va
 * `$[NS]` orqali chaqiradi. Bu faylda runtime `export` bo'lmasligi kerak (ES3).
 */
import { JSX_VERSION, NS } from "../shared/constants";

const host = $ as unknown as { [key: string]: unknown };

host[NS] = {
  version: JSX_VERSION,
};
