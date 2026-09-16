// @vitest-environment node

import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("runs Node SQLite tests under the canonical Vitest configuration", () => {
  const database = new DatabaseSync(":memory:");
  expect(database.prepare("SELECT 1 AS value").get()).toEqual({ value: 1 });
  database.close();
});
