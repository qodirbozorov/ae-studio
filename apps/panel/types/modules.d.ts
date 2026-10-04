// Tiplarsiz Babel presetlari (faqat jsx build konfiguratsiyasida ishlatiladi).
declare module "@babel/preset-env" {
  import type { PluginItem } from "@babel/core";
  const preset: PluginItem;
  export default preset;
}

declare module "@babel/preset-typescript" {
  import type { PluginItem } from "@babel/core";
  const preset: PluginItem;
  export default preset;
}
