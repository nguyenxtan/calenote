// @vitest-environment node
import { it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The consumed authority suite remains bound to its historical application,
// harness and executing root. New-candidate regressions live in runner.test.ts.
it("historical replay authority remains verified in its immutable checkout", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "replay-immutable-suite-")));
  const env = { PATH: process.env.PATH, HOME: "/tmp", TMPDIR: "/tmp", NO_COLOR: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } as unknown as NodeJS.ProcessEnv;
  try {
    execFileSync("git", ["clone", "--local", "--shared", "--no-hardlinks", "--quiet", process.cwd(), root], { env });
    execFileSync("git", ["-C", root, "checkout", "--detach", "--quiet", "fd6fddb91707079388bf7e24bf809833bbc09a1e"], { env });
    // Original copied-checkout attack creates a fixture commit. Identical
    // immutable harness bytes may require an empty fixture commit.
    const historicalTest = join(root, "tools/benchmark/context-contract-single-replay.test.ts");
    const original = readFileSync(historicalTest, "utf8");
    const commitArgs = '"commit", "--quiet", "-m", "Local trusted-loader fixture"';
    expect(original).toContain(commitArgs);
    writeFileSync(historicalTest, original.replace(commitArgs, '"commit", "--allow-empty", "--quiet", "-m", "Local trusted-loader fixture"'));
    symlinkSync(join(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
    const output = execFileSync(process.execPath, [join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "tools/benchmark/context-contract-single-replay.test.ts"], { cwd: root, env, encoding: "utf8", timeout: 60000 });
    expect(output).toMatch(/32 passed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60000);
