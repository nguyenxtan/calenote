import { registerHooks } from "node:module";
import { extname } from "node:path";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && extname(specifier) === "") {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      }
    }
    return nextResolve(specifier, context);
  },
});
