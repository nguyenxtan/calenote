// @vitest-environment node
import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, cpSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

it.each([["application", false], ["application", true], ["harness", false], ["harness", true]] as const)("module-load proof rejects restored %s disk with stale cache=%s", (kind, stale) => {
  const candidate = execFileSync("git", ["rev-parse", "HEAD"], {encoding:"utf8"}).trim();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "loaded-candidate-")));
  try {
    execFileSync("git", ["clone", "--quiet", "--local", "--shared", "--no-hardlinks", process.cwd(), root]);
    cpSync(join(process.cwd(), "tools/benchmark/register-conversation-loader.mjs"), join(root, "tools/benchmark/register-conversation-loader.mjs"));
    execFileSync("git", ["-C", root, "add", "tools/benchmark/register-conversation-loader.mjs"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--allow-empty", "-m", "Reviewed loader fixture"]);
    const harness = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    symlinkSync(join(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
    const program = `import {readFileSync,writeFileSync} from 'node:fs';
      import {assertLoadedCandidateModules} from './tools/benchmark/register-conversation-loader.mjs';
      const path=${JSON.stringify(kind === "application" ? "src/modules/conversation/context-contract/protocol.ts" : "tools/benchmark/context-contract-runner.ts")}, original=readFileSync(path,'utf8');
      if(${stale})writeFileSync(path,original+'\\n// cached noncandidate bytes\\n');
      await import('./'+path);
      await import('./src/modules/conversation/context-contract/protocol.ts');
      writeFileSync(path,original);
      try{assertLoadedCandidateModules(process.cwd(),${JSON.stringify(candidate)},${JSON.stringify(harness)});console.log('PASS')}
      catch(e){console.log(e.message)}`;
    const programPath = join(root, "probe.mjs"); writeFileSync(programPath, program);
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./tools/benchmark/register-conversation-loader.mjs", programPath], {
      cwd: root, env: { PATH: process.env.PATH, HOME: "/tmp", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } as unknown as NodeJS.ProcessEnv, encoding: "utf8" });
    expect(output.trim()).toBe(stale ? (kind === "application" ? "VALIDATION_LOADED_APPLICATION_CHANGED" : "VALIDATION_LOADED_HARNESS_CHANGED") : "PASS");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each(["--experimental-loader=./extra.mjs", "--require=./extra.cjs", "--import=./extra.mjs"])("unapproved preload spelling %s fails closed", flag => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "preload-fence-")));
  try {
    execFileSync("git", ["clone", "--quiet", "--local", "--shared", "--no-hardlinks", process.cwd(), root]);
    cpSync(join(process.cwd(), "tools/benchmark/register-conversation-loader.mjs"), join(root, "tools/benchmark/register-conversation-loader.mjs"));
    symlinkSync(join(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
    writeFileSync(join(root, "extra.mjs"), "export {};\n"); writeFileSync(join(root, "extra.cjs"), "module.exports={};\n");
    const program = "import {assertLoadedCandidateModules} from './tools/benchmark/register-conversation-loader.mjs'; await import('./src/modules/conversation/context-contract/protocol.ts'); try{assertLoadedCandidateModules(process.cwd(),'9c3bc72263ff791c0d45c8874b420e50819197e0');console.log('PASS')}catch(e){console.log(e.message)}";
    const output = execFileSync(process.execPath, [flag, "--experimental-strip-types", "--import", "./tools/benchmark/register-conversation-loader.mjs", "--input-type=module", "-e", program], {
      cwd: root, env: { PATH: process.env.PATH, HOME: "/tmp", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } as unknown as NodeJS.ProcessEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(output.trim()).toBe("VALIDATION_LOADER_NOT_TRUSTED");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
