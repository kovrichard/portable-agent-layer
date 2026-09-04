import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-identity-cli-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

async function actorLib() {
  return await import("../src/hooks/lib/actor");
}

describe("seedActorLabel", () => {
  test("adopts the principal's name while the label is still the default", async () => {
    writeSettings("Rico");
    const { seedActorLabel, loadActor } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    expect(seedActorLabel(HOME).label).toBe("Rico");
    expect(loadActor(HOME).label).toBe("Rico");
  });

  test("never overwrites a label the user already chose", async () => {
    writeSettings("Rico");
    const { seedActorLabel, setActorLabel } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    setActorLabel("chosen", HOME);
    expect(seedActorLabel(HOME).label).toBe("chosen");
  });

  test("does NOT adopt the settings placeholder 'User' as a name", async () => {
    writeSettings("User");
    const { seedActorLabel, defaultActorLabel } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    const actor = seedActorLabel(HOME);
    expect(actor.label).toBe(defaultActorLabel(actor.id));
  });

  test("leaves the default in place when no name is configured", async () => {
    writeSettings(undefined);
    const { seedActorLabel, defaultActorLabel } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    const actor = seedActorLabel(HOME);
    expect(actor.label).toBe(defaultActorLabel(actor.id));
  });

  test("rejects the 'User' placeholder even when it arrives padded", async () => {
    writeSettings("  User  ");
    const { seedActorLabel, defaultActorLabel } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    const actor = seedActorLabel(HOME);
    expect(actor.label).toBe(defaultActorLabel(actor.id));
  });

  test("trims a padded name rather than labelling the actor with whitespace", async () => {
    writeSettings("  Rico  ");
    const { seedActorLabel } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    expect(seedActorLabel(HOME).label).toBe("Rico");
  });

  test("is idempotent — a second run changes nothing", async () => {
    writeSettings("Rico");
    const { seedActorLabel } = await actorLib();
    const { reload } = await import("../src/hooks/lib/settings");
    reload();
    const first = seedActorLabel(HOME);
    const second = seedActorLabel(HOME);
    expect(second.label).toBe("Rico");
    expect(second.id).toBe(first.id);
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
    expect(await run("actor", ["label", "Rico"])).toBe(0);
    const { loadActor, readActorRegistry } = await actorLib();
    expect(loadActor(HOME).label).toBe("Rico");
    expect(readActorRegistry().map((e) => e.label)).toContain("Rico");
  });

  test("label renames the machine and registers the new label", async () => {
    expect(await run("machine", ["label", "workstation"])).toBe(0);
    const { loadMachine, readRegistry } = await import("../src/hooks/lib/machine");
    expect(loadMachine(HOME).label).toBe("workstation");
    expect(readRegistry().map((e) => e.label)).toContain("workstation");
  });

  test("joins a multi-word name rather than taking only the first token", async () => {
    expect(await run("actor", ["label", "Rico", "K"])).toBe(0);
    const { loadActor } = await actorLib();
    expect(loadActor(HOME).label).toBe("Rico K");
  });

  test("renaming does not change the id, so existing records still resolve", async () => {
    const { loadActor } = await actorLib();
    const before = loadActor(HOME).id;
    await run("actor", ["label", "Rico"]);
    expect(loadActor(HOME).id).toBe(before);
  });

  test("a blank name is refused instead of clearing the label", async () => {
    expect(await run("actor", ["label", "   "])).toBe(1);
    const { loadActor, defaultActorLabel } = await actorLib();
    const actor = loadActor(HOME);
    expect(actor.label).toBe(defaultActorLabel(actor.id));
  });

  test("renaming to the current name is idempotent, not an error", async () => {
    expect(await run("actor", ["label", "Rico"])).toBe(0);
    expect(await run("actor", ["label", "Rico"])).toBe(0);
    const { loadActor } = await actorLib();
    expect(loadActor(HOME).label).toBe("Rico");
  });

  test("a missing name is refused", async () => {
    expect(await run("actor", ["label"])).toBe(1);
  });

  test("an unknown action is refused", async () => {
    expect(await run("actor", ["rename", "Rico"])).toBe(1);
    expect(await run("machine", ["delete"])).toBe(1);
  });
});
