// ExtendScript'da JSON yo'q: lib/json2.js (bundle boshida `@include`) uni ta'minlaydi.
// Global obyekt xususiyati bo'lishi uchun ambient `var` kerak.
// eslint-disable-next-line no-var
declare var JSON: {
  stringify(value: unknown): string;
  parse(text: string): unknown;
};
