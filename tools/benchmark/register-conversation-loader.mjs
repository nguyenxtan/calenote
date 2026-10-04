import { registerHooks } from "node:module";
import { extname, resolve, relative } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Closed registry records bytes actually handed to the module compiler, not
// later filesystem contents. No payload/user data is captured here.
const loadedSources = new Map();
const digest = source => createHash("sha256").update(source).digest("hex");
loadedSources.set(import.meta.url, digest(readFileSync(fileURLToPath(import.meta.url))));
export function assertLoadedCandidateModules(root, candidate, harnessRevision) {
  const imports = [];
  for (let i = 0; i < process.execArgv.length; i++) {
    const arg = process.execArgv[i];
    if (arg === "--import") imports.push(process.execArgv[++i]);
    else if (arg.startsWith("--import=")) imports.push(arg.slice(9));
    else if (["--require", "-r", "--loader", "--experimental-loader"].includes(arg) || arg.startsWith("--require=") || arg.startsWith("--loader=")
      || arg.startsWith("--experimental-loader=") || arg.startsWith("-r")) throw new Error("VALIDATION_LOADER_NOT_TRUSTED");
  }
  if (process.env.NODE_OPTIONS || imports.length !== 1 || resolve(imports[0]) !== fileURLToPath(import.meta.url)) throw new Error("VALIDATION_LOADER_NOT_TRUSTED");
  if (!/^[a-f0-9]{40}$/u.test(candidate)) throw new Error("VALIDATION_CANDIDATE_MISMATCH");
  let count = 0;
  for (const [url, actual] of loadedSources) {
    if (!url.startsWith("file:")) continue;
    const path = relative(root, fileURLToPath(url));
    const application = path.startsWith("src/");
    const harness = path.startsWith("tools/benchmark/") && harnessRevision !== undefined;
    if (!application && !harness) continue;
    if (application) count++;
    const revision = application ? candidate : harnessRevision;
    if (!/^[a-f0-9]{40}$/u.test(revision)) throw new Error("VALIDATION_HARNESS_MISMATCH");
    const expected = execFileSync("git", ["-C", root, "show", `${revision}:${path}`], {
      env: { PATH: "/usr/bin:/bin", HOME: "/tmp", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    if (digest(expected) !== actual) throw new Error(application ? "VALIDATION_LOADED_APPLICATION_CHANGED" : "VALIDATION_LOADED_HARNESS_CHANGED");
  }
  if (!count) throw new Error("VALIDATION_APPLICATION_NOT_LOADED");
  return { loadedApplicationModules: count, loadedApplicationProof: "PASS" };
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if(context.parentURL?.includes("/node_modules/"))return nextResolve(specifier,context);
    if(specifier.endsWith(".json")) return nextResolve(specifier,{...context,importAttributes:{type:"json"}});
    if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(resolve("src", specifier.slice(2)) + ".ts").href, context);
    if (specifier.startsWith(".") && ["", ".test-support"].includes(extname(specifier))) {
      try { return nextResolve(specifier + ".ts", context); }
      catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
    }
    return nextResolve(specifier, context);
  },
  load(url,context,nextLoad) {
    const loaded=nextLoad(url,url.endsWith(".json")?{...context,importAttributes:{type:"json"}}:context);
    if (loaded.source !== undefined && loaded.source !== null && !url.includes("/node_modules/")) loadedSources.set(url, digest(typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source)));
    if(url.endsWith(".ts")&&!url.includes("/node_modules/")) return {...loaded,format:"module",source:ts.transpileModule(String(loaded.source),{
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},fileName:url,
    }).outputText};
    return loaded;
  },
});
