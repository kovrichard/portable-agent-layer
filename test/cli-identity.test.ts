import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

let HOME: string;

function writeSettings(principalName: string | undefined): void {
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  writeFileSync(
    resolve(HOME, "memory", "pal-settings.json"),
    JSON.stringify({
      identity: { ai: { name: "Jarvis" }, principal: { name: principalName } },
    })
  );
}

beforeEach(async () => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-identity-cli-"));
  process.env.PAL_HOME = HOME;
  // settings caches per process and bun shares one across test files.
  (await import("../src/hooks/lib/settings")).reload();
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

async function actorLib() {
  return await import("../src/hooks/lib/actor");
}

describe("actor label derivation", () => {
  test("adopts the principal's name while the label is still the default", async () => {
    writeSettings("Ada");
    const { loadActor } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    expect(loadActor(HOME).label).toBe("Ada");
  });

  test("holds on an install that never ran the seeding step", async () => {
    writeSettings("Ada");
    const { loadActor, actorFilePath, defaultActorLabel } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    // An actor minted by an upgrade: on disk it still carries the default label.
    const minted = loadActor(HOME);
    const raw = JSON.parse(readFileSync(actorFilePath(HOME), "utf-8"));
    expect(raw.label).toBe(defaultActorLabel(minted.id));
    expect(loadActor(HOME).label).toBe("Ada");
  });

  test("never overwrites a label the user already chose", async () => {
    writeSettings("Ada");
    const { loadActor, setActorLabel } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    setActorLabel("chosen", HOME);
    expect(loadActor(HOME).label).toBe("chosen");
  });

  test("does NOT adopt the settings placeholder 'User' as a name", async () => {
    writeSettings("User");
    const { loadActor, defaultActorLabel } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    const actor = loadActor(HOME);
    expect(actor.label).toBe(defaultActorLabel(actor.id));
  });

  test("leaves the default in place when no name is configured", async () => {
    writeSettings(undefined);
    const { loadActor, defaultActorLabel } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    const actor = loadActor(HOME);
    expect(actor.label).toBe(defaultActorLabel(actor.id));
  });

  test("rejects the 'User' placeholder even when it arrives padded", async () => {
    writeSettings("  User  ");
    const { loadActor, defaultActorLabel } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    const actor = loadActor(HOME);
    expect(actor.label).toBe(defaultActorLabel(actor.id));
  });

  test("trims a padded name rather than labelling the actor with whitespace", async () => {
    writeSettings("  Ada  ");
    const { loadActor } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    expect(loadActor(HOME).label).toBe("Ada");
  });

  test("derives without writing — the stored label is untouched", async () => {
    writeSettings("Ada");
    const { loadActor, actorFilePath, defaultActorLabel } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    const id = loadActor(HOME).id;
    const before = readFileSync(actorFilePath(HOME), "utf-8");
    loadActor(HOME);
    expect(readFileSync(actorFilePath(HOME), "utf-8")).toBe(before);
    expect(JSON.parse(before).label).toBe(defaultActorLabel(id));
  });

  test("the registry entry carries the derived name, so it travels on export", async () => {
    writeSettings("Ada");
    const { ensureActorRegistered, readActorRegistry } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    ensureActorRegistered(HOME);
    expect(readActorRegistry().map((e) => e.label)).toContain("Ada");
  });
});

describe("pal cli actor / machine", () => {
  async function run(subject: "actor" | "machine", args: string[]) {
    const { runIdentity } = await import("../src/cli/identity");
    return runIdentity(subject, args);
  }

  test("shows the current identity with no arguments", async () => {
    expect(await run("actor", [])).toBe(0);
    expect(await run("machine", [])).toBe(0);
  });

  test("label renames the actor and registers the new label", async () => {
    expect(await run("actor", ["label", "Ada"])).toBe(0);
    const { loadActor, readActorRegistry } = await actorLib();
    expect(loadActor(HOME).label).toBe("Ada");
    expect(readActorRegistry().map((e) => e.label)).toContain("Ada");
  });

  test("label renames the machine and registers the new label", async () => {
    expect(await run("machine", ["label", "workstation"])).toBe(0);
    const { loadMachine, readRegistry } = await import("../src/hooks/lib/machine");
    expect(loadMachine(HOME).label).toBe("workstation");
    expect(readRegistry().map((e) => e.label)).toContain("workstation");
  });

  test("joins a multi-word name rather than taking only the first token", async () => {
    expect(await run("actor", ["label", "Ada", "L"])).toBe(0);
    const { loadActor } = await actorLib();
    expect(loadActor(HOME).label).toBe("Ada L");
  });

  test("renaming does not change the id, so existing records still resolve", async () => {
    const { loadActor } = await actorLib();
    const before = loadActor(HOME).id;
    await run("actor", ["label", "Ada"]);
    expect(loadActor(HOME).id).toBe(before);
  });

  test("a blank name is refused instead of clearing the label", async () => {
    expect(await run("actor", ["label", "   "])).toBe(1);
    const { loadActor, defaultActorLabel } = await actorLib();
    const actor = loadActor(HOME);
    expect(actor.label).toBe(defaultActorLabel(actor.id));
  });

  test("renaming to the current name is idempotent, not an error", async () => {
    expect(await run("actor", ["label", "Ada"])).toBe(0);
    expect(await run("actor", ["label", "Ada"])).toBe(0);
    const { loadActor } = await actorLib();
    expect(loadActor(HOME).label).toBe("Ada");
  });

  test("a missing name is refused", async () => {
    expect(await run("actor", ["label"])).toBe(1);
  });

  test("an unknown action is refused", async () => {
    expect(await run("actor", ["rename", "Ada"])).toBe(1);
    expect(await run("machine", ["delete"])).toBe(1);
  });
});
