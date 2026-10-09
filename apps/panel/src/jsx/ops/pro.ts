/**
 * Professional qatlam oplari (Faza 7): `layer.add_solid` (solid / null / adjustment), `layer.set`
 * (3D, transform, blend, parent, matte), `layer.mask`.
 */
import type {
  LayerAddSolidParams,
  LayerMaskParams,
  LayerSetParams,
  OpResultData,
} from "@aes/shared/ae";
import { layerResult, setLayerTiming, transformProperty } from "../lib/ae";
import { makeShape } from "../lib/shapes";
import { findLayerInComp, hasLayerTag, requireComp, requireLayer, stampLayer } from "../lib/trace";
import { hexToRgb, raise } from "../lib/util";

function layerOnly(opId: string, layer: Layer, reused: boolean): OpResultData {
  return { op_id: opId, reused: reused, target: { kind: "layer", name: layer.name } };
}

/** `layer.add_solid` — rangli solid, null yoki adjustment qatlam. */
export function layerAddSolid(p: LayerAddSolidParams, opId: string): OpResultData {
  const comp = requireComp(p.comp);
  const existing = findLayerInComp(comp, opId);
  if (existing !== null) return layerResult(opId, existing, comp, true);

  let layer: AVLayer;
  if (p.kind === "null") {
    layer = comp.layers.addNull();
  } else {
    const color = p.kind === "adjustment" ? [1, 1, 1] : hexToRgb(p.color ?? "#000000");
    const w = p.size === undefined ? comp.width : Math.max(4, Math.round(p.size[0]));
    const h = p.size === undefined ? comp.height : Math.max(4, Math.round(p.size[1]));
    const name = p.name ?? (p.kind === "adjustment" ? "Adjustment" : "Solid");
    layer = comp.layers.addSolid(color as [number, number, number], name, w, h, comp.pixelAspect);
    if (p.kind === "adjustment") layer.adjustmentLayer = true;
  }
  if (p.name !== undefined) layer.name = p.name;
  transformProperty(layer, "ADBE Position").setValue(p.pos);
  if (p.opacity !== undefined) transformProperty(layer, "ADBE Opacity").setValue(p.opacity);
  setLayerTiming(layer, comp, p.start, p.dur);
  stampLayer(layer, opId);
  return layerResult(opId, layer, comp, false);
}

const TRANSFORM: { [key: string]: string | undefined } = {
  anchor: "ADBE Anchor Point",
  position: "ADBE Position",
  scale: "ADBE Scale",
  rotation: "ADBE Rotate Z",
  opacity: "ADBE Opacity",
  rotation_x: "ADBE Rotate X",
  rotation_y: "ADBE Rotate Y",
  orientation: "ADBE Orientation",
};

function blendMode(name: string): BlendingMode {
  let key = name.toUpperCase();
  // AE enum'idagi imlo: SILHOUETE_ALPHA.
  if (key === "SILHOUETTE_ALPHA") key = "SILHOUETE_ALPHA";
  const mode = (BlendingMode as unknown as { [key: string]: BlendingMode | undefined })[key];
  if (mode === undefined) return raise("AE_BAD_PARAMS", "Noma'lum blend rejimi: " + name);
  return mode;
}

function matteType(name: string): TrackMatteType {
  if (name === "alpha_inverted") return TrackMatteType.ALPHA_INVERTED;
  if (name === "luma") return TrackMatteType.LUMA;
  if (name === "luma_inverted") return TrackMatteType.LUMA_INVERTED;
  return TrackMatteType.ALPHA;
}

/** `layer.set` — 3D (avval), transform, blend, motion blur, parent, track matte. */
export function layerSet(p: LayerSetParams, opId: string): OpResultData {
  const layer = requireLayer(p.layer) as AVLayer;
  if (hasLayerTag(layer, opId)) return layerOnly(opId, layer, true);
  if (p.three_d !== undefined) layer.threeDLayer = p.three_d;
  if (p.motion_blur !== undefined) {
    layer.motionBlur = p.motion_blur;
    if (p.motion_blur) layer.containingComp.motionBlur = true;
  }
  const t = p.transform;
  if (t !== undefined) {
    const values = t as unknown as { [key: string]: unknown };
    for (const key in TRANSFORM) {
      if (!Object.prototype.hasOwnProperty.call(TRANSFORM, key)) continue;
      const value = values[key];
      if (value === undefined) continue;
      let prop: Property | null;
      try {
        prop = transformProperty(layer, TRANSFORM[key] as string);
      } catch (_e) {
        prop = null;
      }
      if (prop === null || prop === undefined) {
        return raise("AE_BAD_PARAMS", key + ": bu xususiyat faqat 3D qatlamda (three_d: true)");
      }
      prop.setValue(value as never);
    }
  }
  if (p.blend !== undefined) layer.blendingMode = blendMode(p.blend);
  if (p.parent !== undefined) layer.parent = requireLayer(p.parent);
  if (p.matte !== undefined) {
    const source = requireLayer(p.matte.source) as AVLayer;
    const type = matteType(p.matte.type);
    const modern = layer as unknown as {
      setTrackMatte?: (matte: Layer, type: TrackMatteType) => void;
    };
    if (typeof modern.setTrackMatte === "function") {
      modern.setTrackMatte(source, type);
    } else {
      // AE < 23: matte qatlam bevosita ustida bo'lishi shart.
      source.moveBefore(layer);
      layer.trackMatteType = type;
    }
    source.enabled = false;
  }
  stampLayer(layer, opId);
  return layerOnly(opId, layer, false);
}

const MASK_MODES: { [name: string]: () => MaskMode } = {
  add: () => MaskMode.ADD,
  subtract: () => MaskMode.SUBTRACT,
  intersect: () => MaskMode.INTERSECT,
  lighten: () => MaskMode.LIGHTEN,
  darken: () => MaskMode.DARKEN,
  difference: () => MaskMode.DIFFERENCE,
  none: () => MaskMode.NONE,
};

/** `layer.mask` — yo'l (qatlam koordinatalarida), rejim, feather, expansion, opacity. */
export function layerMask(p: LayerMaskParams, opId: string): OpResultData {
  const layer = requireLayer(p.layer) as AVLayer;
  if (hasLayerTag(layer, opId)) return layerOnly(opId, layer, true);
  const masks = layer.property("ADBE Mask Parade") as PropertyGroup;
  if (!masks.canAddProperty("ADBE Mask Atom")) {
    return raise("AE_BAD_PARAMS", "Bu qatlamga maska qo'shib bo'lmaydi: " + layer.name);
  }
  const mask = masks.addProperty("ADBE Mask Atom") as MaskPropertyGroup;
  mask.name = p.id;
  (mask.property("ADBE Mask Shape") as Property).setValue(makeShape(p.path) as never);
  const mode = MASK_MODES[p.mode];
  if (mode !== undefined) mask.maskMode = mode();
  if (p.feather !== undefined)
    (mask.property("ADBE Mask Feather") as Property).setValue(p.feather as never);
  if (p.expansion !== undefined) {
    (mask.property("ADBE Mask Offset") as Property).setValue(p.expansion as never);
  }
  if (p.opacity !== undefined)
    (mask.property("ADBE Mask Opacity") as Property).setValue(p.opacity as never);
  if (p.inverted === true) mask.inverted = true;
  stampLayer(layer, opId);
  return layerOnly(opId, layer, false);
}
