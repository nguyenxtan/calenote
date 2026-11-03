import { registerHooks } from "node:module";
import { extname } from "node:path";

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".json")) return nextLoad(url, {...context, importAttributes: {...context.importAttributes, type: "json"}});
    return nextLoad(url, context);
  },
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) specifier = new URL(`../../src/${specifier.slice(2)}`, import.meta.url).href;
    // Local TypeScript basenames may contain dots (sqlite-d1.test-support).
    if ((specifier.startsWith(".") || specifier.startsWith("file:")) && ![".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"].includes(extname(specifier))) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      }
    }
    return nextResolve(specifier, context);
  },
});
