import { once } from "node:events";
import { spawn } from "node:child_process";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

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
  afterEach(() => children.forEach((child) => child.kill()));

  it("serves the static Today route even when Next also emits route metadata", async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ["tools/ui-review/phase4a-fixture-server.mjs", "--scenario", "empty", "--port", String(port)], {
      cwd: process.cwd(),
      env: { ...process.env, CALENOTE_VISUAL_FIXTURE: "1", NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    await once(child.stdout!, "data");

    const response = await fetch(`http://127.0.0.1:${port}/app/today`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Today");
  });
});
