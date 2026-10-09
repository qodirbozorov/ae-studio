/**
 * Effekt oplari: `.ffx` preset, matchName bo'yicha effekt + parametrlar (Faza 7: nom/indeks/matchName,
 * rang `#hex`, `FX_UNKNOWN`/`FX_PARAM_UNKNOWN`), o'rnatilgan effektlar ro'yxati va parametr tavsifi.
 */
import type {
  AeContext,
  FxAddParams,
  FxApplyPresetParams,
  FxCatalogParams,
  FxParamsParams,
  OpResultData,
} from "@aes/shared/ae";
import { resolveInRoot } from "../lib/paths";
import { effectParam, paramNames, toAeValue } from "../lib/props";
import { hasLayerTag, requireLayer, stampLayer } from "../lib/trace";
import { isArray, raise } from "../lib/util";

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

function addEffect(layer: Layer, matchName: string): PropertyGroup {
  const parade = layer.property("ADBE Effect Parade") as PropertyGroup;
  if (!parade.canAddProperty(matchName)) {
    return raise("FX_UNKNOWN", "Effekt qo'shib bo'lmaydi (o'rnatilmaganmi?): " + matchName, {
      match_name: matchName,
    });
  }
  return parade.addProperty(matchName) as PropertyGroup;
}

/** `fx.add` — effekt qo'shadi; parametrlar 1-indeks, matchName yoki ko'rinadigan nom bo'yicha. */
export function fxAdd(p: FxAddParams, opId: string): OpResultData {
  const layer = requireLayer(p.layer);
  if (hasLayerTag(layer, opId)) return layerResult(opId, layer, true);
  const effect = addEffect(layer, p.matchName);
  if (p.name !== undefined) effect.name = p.name;
  const params = p.params;
  if (params !== undefined) {
    for (const key in params) {
      if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
      const prop = effectParam(effect, key);
      if (prop === null) {
        return raise(
          "FX_PARAM_UNKNOWN",
          "Effekt parametri topilmadi: " + p.matchName + " → " + key,
          {
            match_name: p.matchName,
            param: key,
            params: paramNames(effect),
          },
        );
      }
      try {
        prop.setValue(toAeValue(params[key]) as never);
      } catch (error) {
        return raise(
          "FX_PARAM_UNKNOWN",
          "Qiymat qo'yilmadi: " + p.matchName + " → " + key + " (" + String(error) + ")",
          { match_name: p.matchName, param: key },
        );
      }
    }
  }
  if (p.enabled === false) effect.enabled = false;
  stampLayer(layer, opId);
  return layerResult(opId, layer, false);
}

interface EffectInfo {
  displayName: string;
  matchName: string;
  category: string;
}

/** `fx.catalog` — o'rnatilgan effektlar (`app.effects`), nom/matchName/kategoriya bo'yicha qidiruv. */
export function fxCatalog(p: FxCatalogParams, opId: string): OpResultData {
  const all = (app as unknown as { effects?: EffectInfo[] }).effects ?? [];
  const query = p.query === undefined ? "" : p.query.toLowerCase();
  const limit = p.limit === undefined ? 200 : p.limit;
  const effects: { name: string; match_name: string; category: string }[] = [];
  let total = 0;
  for (let i = 0; i < all.length; i++) {
    const e = all[i]!;
    const haystack = (e.displayName + " " + e.matchName + " " + e.category).toLowerCase();
    if (query !== "" && haystack.indexOf(query) < 0) continue;
    total++;
    if (effects.length < limit) {
      effects.push({ name: e.displayName, match_name: e.matchName, category: e.category });
    }
  }
  return { op_id: opId, reused: false, info: { effects: effects, total: total } };
}

function valueTypeName(prop: Property): string {
  const t = prop.propertyValueType;
  if (t === PropertyValueType.OneD) return "number";
  if (t === PropertyValueType.TwoD || t === PropertyValueType.TwoD_SPATIAL) return "point2d";
  if (t === PropertyValueType.ThreeD || t === PropertyValueType.ThreeD_SPATIAL) return "point3d";
  if (t === PropertyValueType.COLOR) return "color";
  if (t === PropertyValueType.NO_VALUE) return "group";
  if (t === PropertyValueType.CUSTOM_VALUE) return "custom";
  if (t === PropertyValueType.LAYER_INDEX) return "layer";
  if (t === PropertyValueType.MASK_INDEX) return "mask";
  return "other";
}

/** `fx.params` — effektni vaqtinchalik solid'ga qo'shib, parametrlarini (indeks, nom, tur) o'qiydi. */
export function fxParams(p: FxParamsParams, opId: string): OpResultData {
  const comp = app.project.items.addComp("aes_fx_probe", 200, 200, 1, 1, 30);
  let source: _ItemClasses | null = null;
  try {
    const solid = comp.layers.addSolid([0.5, 0.5, 0.5], "aes_fx_probe", 200, 200, 1);
    source = solid.source;
    const effect = addEffect(solid, p.match_name);
    const params: { [key: string]: unknown }[] = [];
    for (let i = 1; i <= effect.numProperties; i++) {
      const prop = effect.property(i) as Property;
      const type = valueTypeName(prop);
      const entry: { [key: string]: unknown } = {
        index: i,
        name: prop.name,
        match_name: prop.matchName,
        type: type,
      };
      if (type !== "group" && type !== "custom") {
        try {
          const value = prop.value as unknown;
          if (typeof value === "number" || typeof value === "boolean" || isArray(value)) {
            entry.value = value;
          }
          if (prop.hasMin) entry.min = prop.minValue;
          if (prop.hasMax) entry.max = prop.maxValue;
        } catch (_e) {
          // qiymati o'qilmaydigan parametr
        }
      }
      params.push(entry);
    }
    return {
      op_id: opId,
      reused: false,
      info: { name: effect.name, match_name: effect.matchName, params: params },
    };
  } finally {
    comp.remove();
    if (source !== null) source.remove();
  }
}
