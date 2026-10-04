import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "apps/panel/src/js/lib/cep/**",
      "apps/panel/src/js/public/**",
      "apps/panel/src/jsx/lib/**",
      "apps/server/drizzle/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    // ExtendScript (ES3) bundle'iga kiradigan kod: Babel ES5 API'li helper qo'shadigan sintaksis taqiqlanadi.
    // ES5+ API'lar (Array#forEach, Object.keys, JSON...) esa jsx tsconfig'dagi noLib + ES3 tiplari bilan ushlanadi.
    files: [
      "apps/panel/src/jsx/**/*.ts",
      "apps/panel/src/shared/**/*.ts",
      "packages/shared/src/errors.ts",
      "packages/shared/src/result.ts",
      "packages/shared/src/ae.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ClassDeclaration, ClassExpression",
          message: "ES3: class ishlatilmaydi (helper Object.defineProperty talab qiladi).",
        },
        {
          selector: "ForOfStatement",
          message: "ES3: for...of yo'q (Symbol.iterator). Oddiy for siklidan foydalaning.",
        },
        { selector: "SpreadElement", message: "ES3: spread helper'i ES5 API talab qiladi." },
        {
          selector: "ArrayPattern",
          message: "ES3: massiv destrukturizatsiyasi helper talab qiladi.",
        },
        {
          selector: "ObjectPattern > RestElement",
          message: "ES3: obyekt rest helper talab qiladi.",
        },
        {
          selector: "Property[computed=true]",
          message: "ES3: hisoblangan kalit Object.defineProperty ga aylanishi mumkin.",
        },
        {
          selector:
            "Property[kind='get'], Property[kind='set'], MethodDefinition[kind='get'], MethodDefinition[kind='set']",
          message: "ES3: getter/setter yo'q.",
        },
        { selector: ":function[async=true], AwaitExpression", message: "ES3: async/await yo'q." },
        { selector: ":function[generator=true]", message: "ES3: generator yo'q." },
        {
          selector: "TaggedTemplateExpression",
          message: "ES3: tagged template Object.freeze talab qiladi.",
        },
        { selector: "ImportExpression", message: "ES3: dinamik import yo'q." },
      ],
    },
  },
);
