import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Immutable test-only candidate snapshot. Does not move HEAD, mutate the real
 * index, or authorize live work. Prevents current-source tests from relabeling
 * historical paid candidates when application code evolves before commit. */
export function currentFixtureCandidate() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "candidate-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(fixtureRoot, "index") };
  try {
    execFileSync("git", ["read-tree", "HEAD"], { env });
    execFileSync("git", ["add", "src", "migrations", "wrangler.jsonc", "package.json", "pnpm-lock.yaml", "tools/calendar/reference-vectors.json"], { env });
    const tree = execFileSync("git", ["write-tree"], { env, encoding: "utf8" }).trim();
    return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit-tree", tree, "-p", "HEAD", "-m", "Immutable test-only candidate"], { env, encoding: "utf8" }).trim();
  } finally { rmSync(fixtureRoot, { recursive: true, force: true }); }
}
