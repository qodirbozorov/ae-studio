/**
 * After Effects object model'ining test uchun soddalashtirilgan nusxasi (faqat panel oplari ishlatadigan qismi).
 * Indekslar AE'dagidek 1 dan boshlanadi; yangi layer comp'ning tepasiga (1-indeks) qo'shiladi.
 */

export class MockProperty {
  value: unknown;
  constructor(
    readonly matchName: string,
    initial: unknown,
    private readonly children: Record<string, MockProperty> = {},
  ) {
    this.value = initial;
  }
  setValue(value: unknown) {
    this.value = value;
  }
  property(name: string): MockProperty {
    const child = this.children[name];
    if (child === undefined) throw new Error("Property topilmadi: " + name);
    return child;
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
  startTime = 0;
  inPoint = 0;
  outPoint: number;
  enabled = true;
  audioEnabled = true;
  readonly transform: MockProperty;
  readonly text: MockProperty | null;
  constructor(
    readonly containingComp: CompItem,
    readonly source: AVItem | null,
    name: string,
    text?: TextDocument,
  ) {
    this.name = name;
    this.outPoint = containingComp.duration;
    this.transform = new MockProperty("ADBE Transform Group", null, {
      "ADBE Position": new MockProperty("ADBE Position", [
        containingComp.width / 2,
        containingComp.height / 2,
        0,
      ]),
      "ADBE Scale": new MockProperty("ADBE Scale", [100, 100, 100]),
      "ADBE Opacity": new MockProperty("ADBE Opacity", 100),
      "ADBE Anchor Point": new MockProperty("ADBE Anchor Point", [0, 0, 0]),
      "ADBE Rotate Z": new MockProperty("ADBE Rotate Z", 0),
    });
    this.text =
      text === undefined
        ? null
        : new MockProperty("ADBE Text Properties", null, {
            "ADBE Text Document": new MockProperty("ADBE Text Document", text),
          });
  }
  get index(): number {
    return this.containingComp.layersList.indexOf(this) + 1;
  }
  property(name: string): MockProperty {
    if (name === "ADBE Transform Group") return this.transform;
    if (name === "ADBE Text Properties" && this.text !== null) return this.text;
    throw new Error("Layer property topilmadi: " + name);
  }
}

export class CompItem extends AVItem {
  bgColor: number[] = [0, 0, 0];
  pixelAspect = 1;
  readonly layersList: Layer[] = [];
  readonly layers = {
    addText: (text: string) => this.push(new Layer(this, null, text, new TextDocument(text))),
    addBoxText: (size: number[], text: string) => {
      const doc = new TextDocument(text);
      (doc as TextDocument & { boxTextSize?: number[] }).boxTextSize = size;
      return this.push(new Layer(this, null, text, doc));
    },
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
}

export class MockFile {
  constructor(
    readonly fsName: string,
    private readonly fs: Map<string, Partial<MediaMeta>>,
  ) {}
  get exists(): boolean {
    return this.fs.has(this.fsName);
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
  beginUndoGroup(name: string): void;
  endUndoGroup(): void;
  beginSuppressDialogs(): void;
  endSuppressDialogs(alert: boolean): void;
}

export interface MockProject {
  file: MockFile | null;
  itemsList: Item[];
  readonly numItems: number;
  item(index: number): Item;
  items: {
    addComp(name: string, w: number, h: number, pa: number, dur: number, fps: number): CompItem;
    addFolder(name: string): FolderItem;
  };
  importFile(options: { file: MockFile; importAs?: number }): FootageItem;
}

/** Yangi mock AE: `files` — mavjud fayllar (yo'l → media metadata). */
export function createMockAE(
  options: { version?: string; files?: Record<string, Partial<MediaMeta>> } = {},
): MockAE {
  const files = new Map(Object.entries(options.files ?? {}));
  const itemsList: Item[] = [];
  const add = <T extends Item>(item: T) => {
    itemsList.push(item);
    return item;
  };
  const project: MockProject = {
    file: null,
    itemsList,
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
        return add(comp);
      },
      addFolder: (name) => add(new FolderItem(name)),
    },
    importFile(io) {
      if (!io.file.exists) throw new Error("File not found: " + io.file.fsName);
      const meta = files.get(io.file.fsName) ?? {};
      return add(new FootageItem(io.file.name, io.file, meta));
    },
  };
  const app: MockApp = {
    version: options.version ?? "25.2.0x15",
    project,
    undoGroups: [],
    openUndoGroups: 0,
    suppressDialogs: 0,
    beginUndoGroup(name) {
      this.undoGroups.push(name);
      this.openUndoGroups++;
    },
    endUndoGroup() {
      this.openUndoGroups--;
    },
    beginSuppressDialogs() {
      this.suppressDialogs++;
    },
    endSuppressDialogs() {
      this.suppressDialogs--;
    },
  };
  class ImportOptions {
    importAs = ImportAsType.FOOTAGE;
    constructor(readonly file: MockFile) {}
    canImportAs(type: number) {
      return type === ImportAsType.FOOTAGE;
    }
  }
  const FileCtor = function (this: unknown, path: string) {
    return new MockFile(path, files);
  } as unknown as new (path: string) => MockFile;
  return {
    app,
    files,
    globals: {
      app,
      $: { os: "Windows/10 (mock)" },
      File: FileCtor,
      ImportOptions,
      ImportAsType,
      ParagraphJustification,
      CompItem,
      FolderItem,
      FootageItem,
      AVItem,
    },
  };
}
