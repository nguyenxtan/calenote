import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SeriesResponseSchema } from "../../src/contracts/api/reminder-series";

async function freePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a local port.");
  const { port } = address;
  server.close();
  return port;
}

describe("Phase 4A fixture server", () => {
  const children: ReturnType<typeof spawn>[] = [];
  const fixtureRoots: string[] = [];
  afterEach(async () => {
    children.forEach((child) => child.kill());
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it.each(["empty", "series"])("serves an isolated static %s fixture without a pre-existing out directory", async scenario => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "calenote-phase4a-"));
    fixtureRoots.push(fixtureRoot);
    await mkdir(join(fixtureRoot, "app"), { recursive: true });
    await writeFile(join(fixtureRoot, "app", "today.html"), "<main>Today</main>", "utf8");
    const port = await freePort();
    const child = spawn(process.execPath, ["tools/ui-review/phase4a-fixture-server.mjs", "--scenario", scenario, "--port", String(port), "--output-root", fixtureRoot], {
      cwd: process.cwd(),
      env: { ...process.env, CALENOTE_VISUAL_FIXTURE: "1", NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    await once(child.stdout!, "data");

    const response = await fetch(`http://127.0.0.1:${port}/app/today`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Today");
    const seriesResponse = await fetch(`http://127.0.0.1:${port}/api/reminder-series`);
    expect(seriesResponse.status).toBe(200);
    expect(SeriesResponseSchema.parse(await seriesResponse.json()).data.series).toHaveLength(scenario === "series" ? 1 : 0);
  });
});
