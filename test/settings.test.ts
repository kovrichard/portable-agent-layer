import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-settings");

beforeAll(async () => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(resolve(TEST_HOME, "memory"), { recursive: true });

  writeFileSync(
    resolve(TEST_HOME, "memory", "pal-settings.json"),
    JSON.stringify({
      identity: {
        ai: {
          name: "TestBot",
          fullName: "Test Bot System",
          displayName: "TESTBOT",
          catchphrase: "{name} here, ready to test.",
        },
        principal: {
          name: "TestUser",
          timezone: "UTC",
        },
      },
      dynamicContext: {
        selfModel: false,
        wisdom: true,
      },
    })
  );

  process.env.PAL_HOME = TEST_HOME;
  const { reload } = await import("../src/hooks/lib/settings");
  reload();
});

afterAll(async () => {
  delete process.env.PAL_HOME;
  const { reload } = await import("../src/hooks/lib/settings");
  reload();
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

describe("identity", () => {
  test("parses AI and principal identity from pal-settings.json", async () => {
    const { identity, reload } = await import("../src/hooks/lib/settings");
    reload();
    const id = identity();

    expect(id.ai.name).toBe("TestBot");
    expect(id.ai.displayName).toBe("TESTBOT");
    expect(id.ai.catchphrase).toBe("TestBot here, ready to test.");
    expect(id.principal.name).toBe("TestUser");
  });

  test("returns defaults when pal-settings.json is missing", async () => {
    const origHome = process.env.PAL_HOME;
    process.env.PAL_HOME = "/nonexistent";

    const { identity, reload } = await import("../src/hooks/lib/settings");
    reload();
    const id = identity();

    expect(id.ai.name).toBe("Assistant");
    expect(id.ai.displayName).toBe("ASSISTANT");
    expect(id.principal.name).toBe("User");

    process.env.PAL_HOME = origHome;
    reload();
  });
});

describe("isEnabled", () => {
  test("returns false when explicitly disabled", async () => {
    const { isEnabled, reload } = await import("../src/hooks/lib/settings");
    reload();
    expect(isEnabled("selfModel")).toBe(false);
  });

  test("returns true when explicitly enabled", async () => {
    const { isEnabled } = await import("../src/hooks/lib/settings");
    expect(isEnabled("wisdom")).toBe(true);
  });

  test("defaults to true for unset keys", async () => {
    const { isEnabled } = await import("../src/hooks/lib/settings");
    expect(isEnabled("nonexistentKey")).toBe(true);
  });
});

describe("startupFiles", () => {
  test("returns empty when no files configured", async () => {
    const { startupFiles } = await import("../src/hooks/lib/settings");
    expect(startupFiles()).toEqual([]);
  });
});
