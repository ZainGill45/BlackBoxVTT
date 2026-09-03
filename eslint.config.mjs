import globals from "globals";
import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";

const nodeBuiltins = ["fs", "path", "os", "crypto", "child_process", "http", "https", "net", "stream", "url", "util", "zlib", "worker_threads"];

const restrict = (paths, patterns) => ["error", { paths, patterns }];
const restrictPromiseMethod = (methodName) => ({
  selector: `CallExpression[callee.type='MemberExpression']:matches([callee.property.name='${methodName}'], [callee.property.value='${methodName}'])`,
  message: `Use async/await instead of Promise.${methodName}().`,
});

export default tseslint.config(
  {
    ignores: ["node_modules/**", ".vite/**", "out/**", "src/assets/**", "eslint.config.mjs"],
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
  },
  pluginVue.configs["flat/base"],
  {
    files: ["**/*.ts"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.vue"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".vue"],
      },
    },
  },
  {
    files: ["**/*.{ts,vue}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-array-delete": "error",
      "@typescript-eslint/no-duplicate-type-constituents": "error",
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: false }],
      "@typescript-eslint/no-for-in-array": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-misused-new": "error",
      "@typescript-eslint/no-unnecessary-type-constraint": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unsafe-function-type": "error",
      "no-useless-assignment": "error",
      "no-async-promise-executor": "error",
      "no-self-compare": "error",
      "no-sparse-arrays": "error",
      "no-constant-binary-expression": "error",
      "no-compare-neg-zero": "error",
      "no-unsafe-negation": "error",
      "no-restricted-syntax": ["error", restrictPromiseMethod("then"), restrictPromiseMethod("catch"), restrictPromiseMethod("finally")],
      "prefer-const": "error",
    },
  },
  {
    files: ["src/main/main.ts", "src/renderer/logger.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: ["src/main/main.ts"],
    rules: {
      "no-restricted-syntax": ["error", restrictPromiseMethod("catch"), restrictPromiseMethod("finally")],
    },
  },
  {
    files: ["src/main/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-restricted-imports": restrict([{ name: "vue", message: "Main process must not import renderer libraries." }, { name: "pixi.js", message: "Main process must not import renderer libraries." }], [{ group: ["**/renderer/**", "*/renderer/*"], message: "Main process must not import from the renderer. Share code through src/shared." }]),
    },
  },
  {
    files: ["src/renderer/**/*.{ts,vue}"],
    ignores: ["src/renderer/preload.ts"],
    languageOptions: { globals: globals.browser },
    rules: {
      "@typescript-eslint/no-restricted-imports": restrict([{ name: "electron", message: "Renderer is sandboxed. Reach the main process through window.electronAPI (see src/renderer/preload.ts)." }, ...nodeBuiltins.map((name) => ({ name, message: "Renderer is sandboxed and has no Node access. Add an IPC handler in src/main instead." }))], [{ group: ["node:*"], message: "Renderer is sandboxed and has no Node access. Add an IPC handler in src/main instead." }, { group: ["**/main/**", "*/main/*"], message: "Renderer must not import from the main process. Share code through src/shared." }]),
    },
  },
  {
    files: ["src/renderer/preload.ts"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["src/shared/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": restrict([], [{ group: ["**/main/**", "**/renderer/**", "*/main/*", "*/renderer/*"], message: "src/shared must stay a leaf. It cannot depend on main or renderer." }]),
    },
  },
  {
    files: ["*.config.ts", "forge.env.d.ts"],
    languageOptions: { globals: globals.node },
  },
);
