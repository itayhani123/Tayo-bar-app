import { registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import ts from "typescript";

// Node's test runner with the project's TypeScript/alias conventions, no bundler.
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.includes("/node_modules/")) return next(specifier, context);
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/") ? pathToFileURL(resolve("src", specifier.slice(2))) : new URL(specifier, context.parentURL);
      const path = fileURLToPath(base);
      for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
        if ((!extname(path) || !suffix) && existsSync(path + suffix)) return next(pathToFileURL(path + suffix).href, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.tsx?$/.test(url) && !url.includes("/node_modules/")) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }, fileName: fileURLToPath(url),
      }).outputText };
    }
    return next(url, context);
  },
});
