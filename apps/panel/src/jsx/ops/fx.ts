/** Effekt oplari: `.ffx` preset va matchName bo'yicha effekt + parametrlar. */
import type { AeContext, FxAddParams, FxApplyPresetParams, OpResultData } from "@aes/shared/ae";
import { resolveInRoot } from "../lib/paths";
import { hasLayerTag, requireLayer, stampLayer } from "../lib/trace";
import { raise } from "../lib/util";

function layerResult(opId: string, layer: Layer, reused: boolean): OpResultData {
  return { op_id: opId, reused: reused, target: { kind: "layer", name: layer.name } };
}

/** `fx.apply_preset` — ish papkasi ichidagi `.ffx`. */
export function fxApplyPreset(p: FxApplyPresetParams, opId: string, ctx: AeContext): OpResultData {
  const layer = requireLayer(p.layer);
  if (hasLayerTag(layer, opId)) return layerResult(opId, layer, true);
  const file = new File(resolveInRoot(ctx.root, p.ffx));
  if (!file.exists) return raise("ASSET_MISSING", "Preset topilmadi: " + p.ffx);
  (layer as AVLayer).applyPreset(file);
  stampLayer(layer, opId);
  return layerResult(opId, layer, false);
}

/** `fx.add` — effekt qo'shadi; parametrlar matchName yoki ko'rinadigan nom bo'yicha. */
export function fxAdd(p: FxAddParams, opId: string): OpResultData {
  const layer = requireLayer(p.layer);
  if (hasLayerTag(layer, opId)) return layerResult(opId, layer, true);
  const parade = layer.property("ADBE Effect Parade") as PropertyGroup;
  if (!parade.canAddProperty(p.matchName)) {
    return raise("AE_BAD_PARAMS", "Effekt qo'shib bo'lmaydi (plagin yo'qmi?): " + p.matchName);
  }
  const effect = parade.addProperty(p.matchName) as PropertyGroup;
  if (p.name !== undefined) effect.name = p.name;
  const params = p.params;
  if (params !== undefined) {
    for (const key in params) {
      if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
      let prop: Property | null;
      try {
        prop = effect.property(key) as Property;
      } catch (_e) {
        prop = null;
      }
      if (prop === null || prop === undefined) {
        return raise("AE_BAD_PARAMS", "Effekt parametri topilmadi: " + p.matchName + " → " + key);
      }
      prop.setValue(params[key] as never);
    }
  }
  stampLayer(layer, opId);
  return layerResult(opId, layer, false);
}
