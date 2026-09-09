import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("intelligence boundaries", () => {
  it("keeps provider transport and authoritative reminder persistence outside the foundation", async () => {
    const directory = resolve(process.cwd(), "src/modules/intelligence");
    const [contracts, service] = await Promise.all([
      readFile(resolve(directory, "contracts.ts"), "utf8"),
      readFile(resolve(directory, "service.ts"), "utf8"),
    ]);
    const foundation = `${contracts}\n${service}`.toLowerCase();

    expect(foundation).not.toContain("openrouter");
    expect(foundation).not.toContain("fetch(");
    expect(foundation).not.toContain("d1");
    expect(foundation).not.toContain("createmanualreminder");
    expect(foundation).not.toContain("createreminderactioncandidate");
  });
});
