import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
/**
 * After Effects object model'ining test uchun soddalashtirilgan nusxasi (faqat panel oplari ishlatadigan qismi).
 * Indekslar AE'dagidek 1 dan boshlanadi; yangi layer comp'ning tepasiga (1-indeks) qo'shiladi.
 * Property'lar matchName, ko'rinadigan nom yoki 1-indeks bo'yicha olinadi (`property(...)`).
 */

export const KeyframeInterpolationType = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };
export const PropertyValueType = {
  NO_VALUE: 6412,
  ThreeD_SPATIAL: 6413,
  ThreeD: 6414,
  TwoD_SPATIAL: 6415,
  TwoD: 6416,
  OneD: 6417,
  COLOR: 6418,
  CUSTOM_VALUE: 6419,
  MARKER: 6420,
  LAYER_INDEX: 6421,
  MASK_INDEX: 6422,
  SHAPE: 6423,
  TEXT_DOCUMENT: 6424,
};

export class KeyframeEase {
  constructor(
    readonly speed: number,
    readonly influence: number,
  ) {}
}

export interface MockKey {
  time: number;
  value: unknown;
  inInterp: number;
  outInterp: number;
  inEase: KeyframeEase[] | null;
  outEase: KeyframeEase[] | null;
}

type Factory = () => MockProperty;

/** AE'da TextDocument qiymat sifatida ishlaydi: o'qish va yozishda nusxa olinadi. */
function copyValue(value: unknown): unknown {
  return value instanceof TextDocument
    ? Object.assign(Object.create(Object.getPrototypeOf(value) as object) as object, value)
    : value;
}

export class MockProperty {
  private stored: unknown;
  get value(): unknown {
    return copyValue(this.stored);
  }
  set value(next: unknown) {
    this.stored = copyValue(next);
  }
  expression = "";
  readonly keys: MockKey[] = [];
  readonly children: MockProperty[];
  readonly name: string;
  private readonly addable: Record<string, Factory>;

  constructor(
    readonly matchName: string,
    initial: unknown = null,
    children: MockProperty[] | Record<string, MockProperty> = [],
    options: { name?: string; addable?: Record<string, Factory> } = {},
  ) {
    this.value = initial;
    this.children = Array.isArray(children) ? children : Object.values(children);
    this.name = options.name ?? matchName;
    this.addable = options.addable ?? {};
  }

  setValue(value: unknown) {
    if (this.keys.length > 0) throw new Error("Keyframe'li property'ga setValue mumkin emas");
    this.value = value;
  }

  /** Haqiqiy AE kabi hech narsa qaytarmaydi; indeks `nearestKeyIndex` bilan olinadi. */
  setValueAtTime(time: number, value: unknown): void {
    const existing = this.keys.findIndex((k) => Math.abs(k.time - time) < 1e-6);
    const key: MockKey = {
      time,
      value: copyValue(value),
      inInterp: KeyframeInterpolationType.LINEAR,
      outInterp: KeyframeInterpolationType.LINEAR,
      inEase: null,
      outEase: null,
    };
    if (existing >= 0) this.keys[existing] = key;
    else {
      this.keys.push(key);
      this.keys.sort((a, b) => a.time - b.time);
    }
  }

  removeKey(index: number): void {
    if (index < 1 || index > this.keys.length) throw new Error("Keyframe indeksi noto'g'ri");
    this.keys.splice(index - 1, 1);
  }

  /** Chuqur nusxa (comp `duplicate` uchun). */
  clone(): MockProperty {
    const copy = new MockProperty(
      this.matchName,
      this.value,
      this.children.map((c) => c.clone()),
      { name: this.name, addable: this.addable },
    );
    copy.expression = this.expression;
    for (const key of this.keys) copy.keys.push({ ...key, value: copyValue(key.value) });
    return copy;
  }

  nearestKeyIndex(time: number): number {
    if (this.keys.length === 0) throw new Error("Keyframe yo'q");
    let best = 0;
    for (let i = 1; i < this.keys.length; i++) {
      if (Math.abs(this.keys[i]!.time - time) < Math.abs(this.keys[best]!.time - time)) best = i;
    }
    return best + 1;
  }

  get canSetExpression(): boolean {
    return this.children.length === 0;
  }

  get propertyValueType(): number {
    if (this.children.length > 0) return PropertyValueType.NO_VALUE;
    if (this.value instanceof TextDocument) return PropertyValueType.TEXT_DOCUMENT;
    if (Array.isArray(this.value)) {
      const spatial = /Position|Anchor Point/.test(this.matchName);
      if (this.value.length === 2)
        return spatial ? PropertyValueType.TwoD_SPATIAL : PropertyValueType.TwoD;
      if (this.value.length === 4) return PropertyValueType.COLOR;
      return spatial ? PropertyValueType.ThreeD_SPATIAL : PropertyValueType.ThreeD;
    }
    return PropertyValueType.OneD;
  }

  get numKeys(): number {
    return this.keys.length;
  }

  private key(index: number): MockKey {
    const key = this.keys[index - 1];
    if (key === undefined) throw new Error("Keyframe indeksi noto'g'ri: " + index);
    return key;
  }

  keyTime(index: number): number {
    return this.key(index).time;
  }

  keyValue(index: number): unknown {
    return this.key(index).value;
  }

  setInterpolationTypeAtKey(index: number, inType: number, outType?: number) {
    const key = this.key(index);
    key.inInterp = inType;
    key.outInterp = outType ?? inType;
  }

  setTemporalEaseAtKey(index: number, inEase: KeyframeEase[], outEase?: KeyframeEase[]) {
    const key = this.key(index);
    key.inEase = inEase;
    key.outEase = outEase ?? inEase;
  }

  get numProperties(): number {
    return this.children.length;
  }

  property(nameOrIndex: string | number): MockProperty {
    const child =
      typeof nameOrIndex === "number"
        ? this.children[nameOrIndex - 1]
        : this.children.find((c) => c.matchName === nameOrIndex || c.name === nameOrIndex);
    if (child === undefined) throw new Error("Property topilmadi: " + String(nameOrIndex));
    return child;
  }

  canAddProperty(matchName: string): boolean {
    return this.addable[matchName] !== undefined;
  }

  addProperty(matchName: string): MockProperty {
    const factory = this.addable[matchName];
    if (factory === undefined) throw new Error("Qo'shib bo'lmaydi: " + matchName);
    const created = factory();
    this.children.push(created);
    return created;
  }
}

export class TextDocument {
  font = "ArialMT";
  fontSize = 36;
  fillColor: number[] = [1, 1, 1];
  applyFill = true;
  applyStroke = false;
  strokeColor: number[] = [0, 0, 0];
  strokeWidth = 0;
  strokeOverFill = false;
  justification = 7413; // LEFT_JUSTIFY
  tracking = 0;
  leading = 0;
  allCaps = false;
  constructor(public text: string) {}
}

/** Effektlar katalogi: matchName → (ko'rinadigan nom, parametrlar). */
const EFFECTS: Record<string, { name: string; params: [string, string, unknown][] }> = {
  "ADBE Gaussian Blur 2": {
    name: "Gaussian Blur",
    params: [
      ["ADBE Gaussian Blur 2-0001", "Blurriness", 0],
      ["ADBE Gaussian Blur 2-0003", "Repeat Edge Pixels", false],
    ],
  },
  "ADBE Fill": {
    name: "Fill",
    params: [["ADBE Fill-0002", "Color", [1, 0, 0]]],
  },
};

/** Shablonlardagi "Color Control" effekti (ko'rinadigan nomi bilan). */
export function colorControl(name: string, color: number[] = [1, 1, 1, 1]): MockProperty {
  return new MockProperty(
    "ADBE Color Control",
    null,
    [new MockProperty("ADBE Color Control-0001", color, [], { name: "Color" })],
    { name },
  );
}

function effectFactories(): Record<string, Factory> {
  const out: Record<string, Factory> = {};
  for (const [matchName, spec] of Object.entries(EFFECTS)) {
    out[matchName] = () =>
      new MockProperty(
        matchName,
        null,
        spec.params.map(([mn, name, value]) => new MockProperty(mn, value, [], { name })),
        { name: spec.name },
      );
  }
  return out;
}

function shapeContents(): MockProperty {
  const vectorItems: Record<string, Factory> = {
    "ADBE Vector Shape - Rect": () =>
      new MockProperty("ADBE Vector Shape - Rect", null, [
        new MockProperty("ADBE Vector Rect Size", [100, 100]),
        new MockProperty("ADBE Vector Rect Position", [0, 0]),
        new MockProperty("ADBE Vector Rect Roundness", 0),
      ]),
    "ADBE Vector Shape - Ellipse": () =>
      new MockProperty("ADBE Vector Shape - Ellipse", null, [
        new MockProperty("ADBE Vector Ellipse Size", [100, 100]),
        new MockProperty("ADBE Vector Ellipse Position", [0, 0]),
      ]),
    "ADBE Vector Graphic - Fill": () =>
      new MockProperty("ADBE Vector Graphic - Fill", null, [
        new MockProperty("ADBE Vector Fill Color", [1, 1, 1, 1]),
        new MockProperty("ADBE Vector Fill Opacity", 100),
      ]),
  };
  return new MockProperty("ADBE Root Vectors Group", null, [], {
    addable: {
      "ADBE Vector Group": () =>
        new MockProperty("ADBE Vector Group", null, [
          new MockProperty("ADBE Vectors Group", null, [], { addable: vectorItems }),
        ]),
    },
  });
}

let nextId = 1;

export class Item {
  readonly id = nextId++;
  comment = "";
  parentFolder: FolderItem | null = null;
  constructor(public name: string) {}
}

export class FolderItem extends Item {}

export class AVItem extends Item {
  constructor(
    name: string,
    public width: number,
    public height: number,
    public duration: number,
    public frameRate: number,
    public hasVideo = true,
    public hasAudio = false,
  ) {
    super(name);
  }
  get frameDuration(): number {
    return this.frameRate > 0 ? 1 / this.frameRate : 0;
  }
}

export class FootageItem extends AVItem {
  constructor(
    name: string,
    readonly file: MockFile,
    meta: Partial<MediaMeta>,
  ) {
    super(
      name,
      meta.width ?? 0,
      meta.height ?? 0,
      meta.duration ?? 0,
      meta.frameRate ?? 0,
      meta.hasVideo ?? true,
      meta.hasAudio ?? false,
    );
  }
}

export class Layer {
  comment = "";
  name: string;
  private start = 0;
  inPoint = 0;
  outPoint: number;
  /** AE kabi: startTime o'zgarsa layer butunlay siljiydi (in/out ham). */
  get startTime(): number {
    return this.start;
  }
  set startTime(value: number) {
    const delta = value - this.start;
    this.start = value;
    this.inPoint += delta;
    this.outPoint += delta;
  }
  enabled = true;
  audioEnabled = true;
  readonly presets: string[] = [];
  readonly root: MockProperty;
  private remap = false;
  get timeRemapEnabled(): boolean {
    return this.remap;
  }
  /** AE kabi: yoqilganda 2 kalit (layer boshi → 0, manba oxiri → davomiylik). */
  set timeRemapEnabled(value: boolean) {
    if (value === this.remap) return;
    this.remap = value;
    if (!value) {
      const index = this.root.children.findIndex((c) => c.matchName === "ADBE Time Remapping");
      if (index >= 0) this.root.children.splice(index, 1);
      return;
    }
    const duration = this.source?.duration ?? 0;
    const prop = new MockProperty("ADBE Time Remapping", 0, [], { name: "Time Remap" });
    prop.setValueAtTime(this.startTime, 0);
    prop.setValueAtTime(this.startTime + duration, duration);
    this.root.children.push(prop);
  }
  replaceSource(item: AVItem, _fixExpressions: boolean): void {
    this.source = item;
  }
  constructor(
    readonly containingComp: CompItem,
    public source: AVItem | null,
    name: string,
    extra: { text?: TextDocument; shape?: boolean; root?: MockProperty } = {},
  ) {
    this.name = name;
    this.outPoint = containingComp.duration;
    const groups = [
      new MockProperty("ADBE Transform Group", null, [
        new MockProperty("ADBE Anchor Point", [0, 0, 0]),
        new MockProperty(
          "ADBE Position",
          [containingComp.width / 2, containingComp.height / 2, 0],
          [],
          { name: "Position" },
        ),
        new MockProperty("ADBE Scale", [100, 100, 100], [], { name: "Scale" }),
        new MockProperty("ADBE Rotate Z", 0, [], { name: "Rotation" }),
        new MockProperty("ADBE Opacity", 100, [], { name: "Opacity" }),
      ]),
      new MockProperty("ADBE Effect Parade", null, [], { addable: effectFactories() }),
      new MockProperty("ADBE Audio Group", null, [new MockProperty("ADBE Audio Levels", [0, 0])]),
    ];
    if (extra.text !== undefined) {
      groups.push(
        new MockProperty("ADBE Text Properties", null, [
          new MockProperty("ADBE Text Document", extra.text),
        ]),
      );
    }
    if (extra.shape === true) groups.push(shapeContents());
    this.root = extra.root ?? new MockProperty("ADBE Layer", null, groups);
  }
  /** Boshqa comp'ga nusxa (comp `duplicate`). */
  cloneInto(comp: CompItem): Layer {
    const copy = new Layer(comp, this.source, this.name, { root: this.root.clone() });
    copy.comment = this.comment;
    copy.start = this.start;
    copy.inPoint = this.inPoint;
    copy.outPoint = this.outPoint;
    copy.enabled = this.enabled;
    copy.audioEnabled = this.audioEnabled;
    return copy;
  }
  get index(): number {
    return this.containingComp.layersList.indexOf(this) + 1;
  }
  property(name: string): MockProperty {
    return this.root.property(name);
  }
  /** Qisqa yo'l: testlarda transform property'si. */
  transform(matchName: string): MockProperty {
    return this.property("ADBE Transform Group").property(matchName);
  }
  applyPreset(file: MockFile) {
    if (!file.exists) throw new Error("Preset topilmadi: " + file.fsName);
    this.presets.push(file.fsName);
  }
}

export class CompItem extends AVItem {
  /** `saveFrameToPng` chaqirilgan vaqtlar. */
  readonly savedFrames: number[] = [];
  saveFrameToPng(time: number, file: MockFile): void {
    this.savedFrames.push(time);
    file.writePng(this.width, this.height);
  }
  bgColor: number[] = [0, 0, 0];
  pixelAspect = 1;
  /** Loyihaga qo'shish (duplicate uchun; loyiha o'rnatadi). */
  owner: ((item: Item) => void) | null = null;
  readonly layersList: Layer[] = [];
  duplicate(): CompItem {
    const copy = new CompItem(
      this.name + " 2",
      this.width,
      this.height,
      this.duration,
      this.frameRate,
    );
    copy.bgColor = [...this.bgColor];
    copy.pixelAspect = this.pixelAspect;
    copy.owner = this.owner;
    copy.parentFolder = this.parentFolder;
    for (const layer of this.layersList) copy.layersList.push(layer.cloneInto(copy));
    this.owner?.(copy);
    return copy;
  }
  readonly layers = {
    addText: (text: string) =>
      this.push(new Layer(this, null, text, { text: new TextDocument(text) })),
    addBoxText: (size: number[], text: string) => {
      const doc = new TextDocument(text);
      (doc as TextDocument & { boxTextSize?: number[] }).boxTextSize = size;
      return this.push(new Layer(this, null, text, { text: doc }));
    },
    addShape: () => this.push(new Layer(this, null, "Shape Layer 1", { shape: true })),
    add: (item: AVItem, duration?: number) => {
      const layer = new Layer(this, item, item.name);
      if (duration !== undefined) layer.outPoint = duration;
      else if (!(item instanceof CompItem) && item.duration > 0) {
        layer.outPoint = Math.min(item.duration, this.duration);
      }
      return this.push(layer);
    },
  };
  get numLayers(): number {
    return this.layersList.length;
  }
  layer(index: number): Layer {
    const found = this.layersList[index - 1];
    if (found === undefined) throw new Error("Layer indeksi noto'g'ri: " + index);
    return found;
  }
  private push(layer: Layer): Layer {
    this.layersList.unshift(layer);
    return layer;
  }
}

export interface MediaMeta {
  width: number;
  height: number;
  duration: number;
  frameRate: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /** `.aep` shablon: loyiha sifatida import qilinganda yaratiladigan comp'lar. */
  template: MockTemplateComp[];
}

/** Mock `.aep` shablon tarkibi. */
export interface MockTemplateComp {
  name: string;
  w: number;
  h: number;
  duration: number;
  fps: number;
  layers: {
    name: string;
    kind: "text" | "solid";
    text?: string;
    /** Layer'dagi "Color Control" effektlari nomlari. */
    colorControls?: string[];
  }[];
}

/** 1×1 PNG (mock `saveFrameToPng` haqiqiy diskka yozganda). */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export class MockFile {
  constructor(
    readonly fsName: string,
    private readonly fs: Map<string, Partial<MediaMeta>>,
    /** true — fayllar haqiqiy diskka ham yoziladi (e2e: panel ffmpeg ularni o'qiydi). */
    private readonly realDisk = false,
  ) {}
  get exists(): boolean {
    if (this.fs.has(this.fsName)) return true;
    // realDisk: panel yuklab olgan audio (ElevenLabs) fayllarini ham AE "ko'radi".
    if (this.realDisk && /\.(mp3|wav|ogg|m4a)$/i.test(this.fsName) && existsSync(this.fsName)) {
      this.fs.set(this.fsName, { hasVideo: false, hasAudio: true, duration: 5 });
      return true;
    }
    return false;
  }
  get parent(): { exists: boolean; create(): boolean } {
    const dir = dirname(this.fsName);
    const real = this.realDisk;
    return {
      exists: real ? existsSync(dir) : true,
      create() {
        if (real) mkdirSync(dir, { recursive: true });
        return true;
      },
    };
  }
  get length(): number {
    return this.fs.has(this.fsName) ? PNG_1X1.length : -1;
  }
  /** `saveFrameToPng` natijasi. */
  writePng(width: number, height: number): void {
    this.fs.set(this.fsName, { width, height });
    if (this.realDisk) {
      mkdirSync(dirname(this.fsName), { recursive: true });
      writeFileSync(this.fsName, PNG_1X1);
    }
  }
  get name(): string {
    return this.fsName.split("/").pop() ?? this.fsName;
  }
}

export const ImportAsType = { COMP_CROPPED_LAYERS: 3, FOOTAGE: 2, COMP: 1, PROJECT: 4 };
export const ParagraphJustification = {
  LEFT_JUSTIFY: 7413,
  RIGHT_JUSTIFY: 7414,
  CENTER_JUSTIFY: 7415,
};

export interface MockAE {
  globals: Record<string, unknown>;
  app: MockApp;
  files: Map<string, Partial<MediaMeta>>;
}

export interface MockApp {
  version: string;
  project: MockProject;
  undoGroups: string[];
  openUndoGroups: number;
  suppressDialogs: number;
  /** Ochilgan/yaratilgan loyihalar tarixi (testlar uchun). */
  opened: string[];
  /** Bekor qilingan undo group'lar (Edit → Undo). */
  undone: string[];
  beginUndoGroup(name: string): void;
  endUndoGroup(): void;
  findMenuCommandId(name: string): number;
  executeCommand(id: number): void;
  beginSuppressDialogs(): void;
  endSuppressDialogs(alert: boolean): void;
  open(file: MockFile): MockProject;
  newProject(): MockProject;
}

export interface MockProject {
  file: MockFile | null;
  rootFolder: FolderItem;
  dirty: boolean;
  itemsList: Item[];
  readonly numItems: number;
  item(index: number): Item;
  items: {
    addComp(name: string, w: number, h: number, pa: number, dur: number, fps: number): CompItem;
    addFolder(name: string): FolderItem;
  };
  importFile(options: { file: MockFile; importAs?: number }): FootageItem;
  save(file?: MockFile): boolean;
  renderQueue: MockRenderQueue;
}

export const RQItemStatus = { QUEUED: 2, RENDERING: 3, DONE: 4, ERR_STOPPED: 5 };

export interface MockRenderItem {
  comp: CompItem;
  render: boolean;
  status: number;
  file: MockFile | null;
  outputModule(index: number): { file: MockFile | null };
  remove(): void;
}

export interface MockRenderQueue {
  itemsList: MockRenderItem[];
  readonly numItems: number;
  item(index: number): MockRenderItem;
  items: { add(comp: CompItem): MockRenderItem };
  render(): void;
  /** Testlar: render qilingan (comp nomi, chiqish yo'li). */
  rendered: { comp: string; path: string }[];
}

/** Yangi mock AE: `files` — mavjud fayllar (yo'l → media metadata). */
export function createMockAE(
  options: {
    version?: string;
    files?: Record<string, Partial<MediaMeta>>;
    /** AE 24+ `app.fonts` (berilmasa — eski AE kabi yo'q). */
    fonts?: string[];
    /** Kadrlar haqiqiy diskka ham yozilsin (e2e). */
    realDisk?: boolean;
    /** Render Queue render'i: chiqish faylini yozadi va haqiqiy yo'lni qaytaradi (berilmasa — shu yo'l). */
    onRender?: (path: string, comp: CompItem) => string;
  } = {},
): MockAE {
  const files = new Map(Object.entries(options.files ?? {}));

  function createRenderQueue(): MockRenderQueue {
    const itemsList: MockRenderItem[] = [];
    const queue: MockRenderQueue = {
      itemsList,
      rendered: [],
      get numItems() {
        return itemsList.length;
      },
      item(index) {
        const found = itemsList[index - 1];
        if (found === undefined) throw new Error("RQ item yo'q: " + index);
        return found;
      },
      items: {
        add(comp) {
          const entry: MockRenderItem = {
            comp,
            render: true,
            status: RQItemStatus.QUEUED,
            file: null,
            outputModule: () => ({
              get file() {
                return entry.file;
              },
              set file(value: MockFile | null) {
                entry.file = value;
              },
            }),
            remove() {
              const index = itemsList.indexOf(entry);
              if (index >= 0) itemsList.splice(index, 1);
            },
          };
          itemsList.push(entry);
          return entry;
        },
      },
      render() {
        for (const entry of itemsList) {
          if (!entry.render || entry.status !== RQItemStatus.QUEUED || entry.file === null)
            continue;
          try {
            const actual = options.onRender?.(entry.file.fsName, entry.comp) ?? entry.file.fsName;
            files.set(actual, {});
            entry.file = new MockFile(actual, files, options.realDisk === true);
            entry.status = RQItemStatus.DONE;
            queue.rendered.push({ comp: entry.comp.name, path: actual });
          } catch {
            entry.status = RQItemStatus.ERR_STOPPED;
          }
        }
      },
    };
    return queue;
  }

  function createProject(file: MockFile | null): MockProject {
    const itemsList: Item[] = [];
    const add = <T extends Item>(item: T) => {
      itemsList.push(item);
      project.dirty = true;
      return item;
    };
    const project: MockProject = {
      file,
      rootFolder: new FolderItem("Root"),
      dirty: false,
      itemsList,
      renderQueue: createRenderQueue(),
      get numItems() {
        return itemsList.length;
      },
      item(index: number) {
        const found = itemsList[index - 1];
        if (found === undefined) throw new Error("Item indeksi noto'g'ri: " + index);
        return found;
      },
      items: {
        addComp: (name, w, h, pa, dur, fps) => {
          const comp = new CompItem(name, w, h, dur, fps);
          comp.pixelAspect = pa;
          comp.owner = add;
          return add(comp);
        },
        addFolder: (name) => add(new FolderItem(name)),
      },
      importFile(io) {
        if (!io.file.exists) throw new Error("File not found: " + io.file.fsName);
        const meta = files.get(io.file.fsName) ?? {};
        if (io.importAs === ImportAsType.PROJECT) {
          if (meta.template === undefined) throw new Error("Loyiha emas: " + io.file.fsName);
          const folder = add(new FolderItem(io.file.name));
          for (const def of meta.template) {
            const comp = new CompItem(def.name, def.w, def.h, def.duration, def.fps);
            comp.owner = add;
            comp.parentFolder = folder;
            add(comp);
            for (const spec of [...def.layers].reverse()) {
              const layer =
                spec.kind === "text"
                  ? comp.layers.addText(spec.text ?? spec.name)
                  : comp.layers.add(new AVItem("Solid", def.w, def.h, def.duration, def.fps));
              layer.name = spec.name;
              const effects = layer.property("ADBE Effect Parade");
              for (const name of spec.colorControls ?? [])
                effects.children.push(colorControl(name));
            }
          }
          return folder as unknown as FootageItem;
        }
        return add(new FootageItem(io.file.name, io.file, meta));
      },
      save(target) {
        const into = target ?? project.file;
        if (into === null) throw new Error("Saqlash uchun fayl yo'q");
        files.set(into.fsName, {});
        if (options.realDisk === true) {
          mkdirSync(dirname(into.fsName), { recursive: true });
          writeFileSync(into.fsName, "mock aep");
        }
        project.file = into;
        project.dirty = false;
        return true;
      },
    };
    return project;
  }

  const app: MockApp = {
    version: options.version ?? "25.2.0x15",
    project: createProject(null),
    undoGroups: [],
    undone: [],
    openUndoGroups: 0,
    suppressDialogs: 0,
    opened: [],
    beginUndoGroup(name) {
      this.undoGroups.push(name);
      this.openUndoGroups++;
    },
    endUndoGroup() {
      this.openUndoGroups--;
    },
    // AE: Edit menyusidagi "Undo <oxirgi group nomi>" (16 — Undo buyrug'i).
    findMenuCommandId(name) {
      const last = this.undoGroups[this.undoGroups.length - 1];
      return last !== undefined && name === "Undo " + last ? 16 : 0;
    },
    executeCommand(id) {
      if (id !== 16) return;
      const last = this.undoGroups.pop();
      if (last !== undefined) this.undone.push(last);
    },
    beginSuppressDialogs() {
      this.suppressDialogs++;
    },
    endSuppressDialogs() {
      this.suppressDialogs--;
    },
    open(file) {
      if (!file.exists) throw new Error("Loyiha topilmadi: " + file.fsName);
      this.project = createProject(file);
      this.opened.push("open:" + file.fsName);
      return this.project;
    },
    newProject() {
      this.project = createProject(null);
      this.opened.push("new");
      return this.project;
    },
  };
  class ImportOptions {
    importAs = ImportAsType.FOOTAGE;
    constructor(readonly file: MockFile) {}
    canImportAs(type: number) {
      const aep = /\.aep$/i.test(this.file.fsName);
      return aep ? type === ImportAsType.PROJECT : type === ImportAsType.FOOTAGE;
    }
  }
  const FileCtor = function (this: unknown, path: string) {
    return new MockFile(path, files, options.realDisk === true);
  } as unknown as new (path: string) => MockFile;
  const folders = new Set<string>();
  const FolderCtor = function (this: unknown, path: string) {
    return {
      fsName: path,
      get exists() {
        return folders.has(path);
      },
      create() {
        folders.add(path);
        if (options.realDisk === true) mkdirSync(path, { recursive: true });
        return true;
      },
    };
  } as unknown as new (path: string) => { exists: boolean; create(): boolean };
  if (options.fonts !== undefined) {
    (app as unknown as { fonts: unknown }).fonts = {
      allFonts: options.fonts.map((familyName) => [{ familyName }]),
    };
  }
  return {
    app,
    files,
    globals: {
      app,
      $: { os: "Windows/10 (mock)", sleep: () => undefined },
      File: FileCtor,
      Folder: FolderCtor,
      RQItemStatus,
      ImportOptions,
      ImportAsType,
      ParagraphJustification,
      KeyframeInterpolationType,
      KeyframeEase,
      PropertyValueType,
      CompItem,
      FolderItem,
      FootageItem,
      AVItem,
    },
  };
}
