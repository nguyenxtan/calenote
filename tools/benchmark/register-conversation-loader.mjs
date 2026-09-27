import { registerHooks } from "node:module";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if(context.parentURL?.includes("/node_modules/"))return nextResolve(specifier,context);
    if(specifier.endsWith(".json")) return nextResolve(specifier,{...context,importAttributes:{type:"json"}});
    if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(resolve("src", specifier.slice(2)) + ".ts").href, context);
    if (specifier.startsWith(".") && extname(specifier) === "") {
      try { return nextResolve(specifier + ".ts", context); }
      catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
    }
    return nextResolve(specifier, context);
  },
  load(url,context,nextLoad) {
    const loaded=nextLoad(url,url.endsWith(".json")?{...context,importAttributes:{type:"json"}}:context);
    if(url.endsWith(".ts")&&!url.includes("/node_modules/")) return {...loaded,format:"module",source:ts.transpileModule(String(loaded.source),{
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},fileName:url,
    }).outputText};
    return loaded;
  },
});
