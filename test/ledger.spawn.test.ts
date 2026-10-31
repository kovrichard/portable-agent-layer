import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { APPLIED, freshLedgerHome, ledgerLib } from "./lib/ledger-fixture";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

let HOME: string;

beforeEach(async () => {
  HOME = await freshLedgerHome(import.meta.file);
});

describe("target paths", () => {
  test("are anchored to the project so they survive a different mount", async () => {
    const root = resolve(HOME, "work", "app");
    mkdirSync(resolve(root, "src"), { recursive: true });
    const { writeProject } = await import("../src/hooks/lib/projects");
    writeProject({
      name: "demo",
      path: root,
      status: "active",
      created: "2026-05-04T10:00:00Z",
      updated: "2026-05-04T10:00:00Z",
    });

    const { recordAction } = await ledgerLib();
    const entry = recordAction({ ...APPLIED, target: resolve(root, "src", "index.ts") });
    expect(entry.target).toBe("{proj:demo}/src/index.ts");
  });
});
