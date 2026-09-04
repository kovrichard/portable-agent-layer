import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-actor-"));
  process.env.PAL_HOME = HOME;
  delete process.env.PAL_SPAWNED_INFERENCE;
  delete process.env.PAL_AGENT;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  delete process.env.PAL_SPAWNED_INFERENCE;
  delete process.env.PAL_AGENT;
  rmSync(HOME, { recursive: true, force: true });
});

async function lib() {
  return await import("../src/hooks/lib/actor");
}

describe("loadActor", () => {
  test("creates memory/actor.json on first call with a uuid", async () => {
    const { loadActor, actorFilePath } = await lib();
    const a = loadActor(HOME);
    expect(a.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(actorFilePath(HOME)).toBe(resolve(HOME, "memory", "actor.json"));
    expect(existsSync(actorFilePath(HOME))).toBe(true);
  });

  test("returns the same id on every subsequent call", async () => {
    const { loadActor } = await lib();
    expect(loadActor(HOME).id).toBe(loadActor(HOME).id);
  });

  test("regenerates when the file is corrupt rather than throwing", async () => {
    const { loadActor, actorFilePath } = await lib();
    mkdirSync(resolve(HOME, "memory"), { recursive: true });
    writeFileSync(actorFilePath(HOME), "not json at all");
    expect(loadActor(HOME).id.length).toBeGreaterThan(0);
  });

  test("REPAIRS rather than regenerates when the id survives", async () => {
    const { loadActor, actorFilePath, defaultActorLabel } = await lib();
    mkdirSync(resolve(HOME, "memory"), { recursive: true });
    writeFileSync(actorFilePath(HOME), JSON.stringify({ id: "kept-id" }));
    const a = loadActor(HOME);
    expect(a.id).toBe("kept-id");
    expect(a.label).toBe(defaultActorLabel("kept-id"));
    expect(Number.isNaN(Date.parse(a.createdAt))).toBe(false);
  });

  test("a whitespace-only stored label falls back to the default", async () => {
    const { loadActor, actorFilePath, defaultActorLabel } = await lib();
    mkdirSync(resolve(HOME, "memory"), { recursive: true });
    writeFileSync(actorFilePath(HOME), JSON.stringify({ id: "kept-id", label: "   " }));
    expect(loadActor(HOME).label).toBe(defaultActorLabel("kept-id"));
  });

  test("an empty id is not usable and is regenerated", async () => {
    const { loadActor, actorFilePath } = await lib();
    mkdirSync(resolve(HOME, "memory"), { recursive: true });
    writeFileSync(actorFilePath(HOME), JSON.stringify({ id: "", label: "x" }));
    expect(loadActor(HOME).id.length).toBeGreaterThan(0);
  });
});

describe("defaultActorLabel", () => {
  test("is derived from the id, never from the principal's name", async () => {
    const { defaultActorLabel } = await lib();
    expect(defaultActorLabel("9f2c8e14-1111-2222-3333-444455556666")).toBe("actor-9f2c");
  });
});

describe("setActorLabel", () => {
  test("changes the label while keeping the id", async () => {
    const { loadActor, setActorLabel } = await lib();
    const before = loadActor(HOME);
    const after = setActorLabel("ada", HOME);
    expect(after.label).toBe("ada");
    expect(after.id).toBe(before.id);
    expect(loadActor(HOME).label).toBe("ada");
  });

  test("ignores an empty label instead of clearing the name", async () => {
    const { setActorLabel } = await lib();
    setActorLabel("ada", HOME);
    expect(setActorLabel("   ", HOME).label).toBe("ada");
  });
});

describe("actor registry", () => {
  test("ensureActorRegistered writes an entry under memory/actors", async () => {
    const { ensureActorRegistered } = await lib();
    const a = ensureActorRegistered(HOME);
    expect(existsSync(resolve(HOME, "memory", "actors", `${a.id}.md`))).toBe(true);
  });

  test("readActorRegistry returns every written actor", async () => {
    const { writeActorEntry, readActorRegistry } = await lib();
    writeActorEntry({ id: "id-a", label: "ada" });
    writeActorEntry({ id: "id-b", label: "grace" });
    expect(
      readActorRegistry()
        .map((e) => e.label)
        .sort()
    ).toEqual(["ada", "grace"]);
  });

  test("re-registering updates the label without duplicating the entry", async () => {
    const { writeActorEntry, readActorRegistry } = await lib();
    writeActorEntry({ id: "id-a", label: "ada" });
    writeActorEntry({ id: "id-a", label: "renamed" });
    const reg = readActorRegistry();
    expect(reg.length).toBe(1);
    expect(reg[0].label).toBe("renamed");
  });

  test("actorDisplayName resolves a known id and falls back to the short id", async () => {
    const { actorDisplayName } = await lib();
    const reg = [{ id: "id-a", label: "ada" }];
    expect(actorDisplayName("id-a", reg)).toBe("ada");
    expect(actorDisplayName("ffff9999-0000-0000-0000-000000000000", [])).toBe("ffff");
  });

  test("suffixes with the short id when two actors share a label", async () => {
    const { actorDisplayName } = await lib();
    const reg = [
      { id: "aaaa1111-0000-0000-0000-000000000000", label: "ada" },
      { id: "bbbb2222-0000-0000-0000-000000000000", label: "ada" },
    ];
    expect(actorDisplayName("aaaa1111-0000-0000-0000-000000000000", reg)).toBe(
      "ada·aaaa"
    );
  });
});

describe("actor identity is distinct from machine identity", () => {
  test("the actor id is not the machine id", async () => {
    const { loadActor } = await lib();
    const { loadMachine } = await import("../src/hooks/lib/machine");
    expect(loadActor(HOME).id).not.toBe(loadMachine(HOME).id);
  });

  test("actor.json TRAVELS in an export, unlike machine.json", async () => {
    const { loadActor } = await lib();
    const { loadMachine } = await import("../src/hooks/lib/machine");
    loadActor(HOME);
    loadMachine(HOME);
    const { collectExportFiles } = await import("../src/hooks/lib/export");
    const files = collectExportFiles();
    expect(files).toContain("memory/actor.json");
    expect(files.some((f) => f.endsWith("machine.json"))).toBe(false);
  });

  test("actor registry entries travel too, so a peer's label resolves", async () => {
    const { ensureActorRegistered } = await lib();
    const a = ensureActorRegistered(HOME);
    const { collectExportFiles } = await import("../src/hooks/lib/export");
    expect(collectExportFiles()).toContain(`memory/actors/${a.id}.md`);
  });

  test("actor.json is ALLOWED at the import boundary where machine.json is not", async () => {
    const { isNeverImport } = await import("../src/hooks/lib/import-merge");
    expect(isNeverImport("memory/actor.json")).toBe(false);
    expect(isNeverImport("machine.json")).toBe(true);
  });
});

describe("currentAttribution", () => {
  test("stamps machine, actor, runtime and authority", async () => {
    const { currentAttribution } = await lib();
    const { loadMachine } = await import("../src/hooks/lib/machine");
    process.env.PAL_AGENT = "codex";
    const stamp = currentAttribution();
    expect(stamp.machine).toBe(loadMachine(HOME).id);
    expect(stamp.actor.length).toBeGreaterThan(0);
    expect(stamp.runtime).toBe("codex");
    expect(stamp.authority).toBe("user");
  });

  test("authority is 'agent' inside a PAL-spawned inference", async () => {
    const { currentAttribution, currentAuthority } = await lib();
    process.env.PAL_SPAWNED_INFERENCE = "1";
    expect(currentAuthority()).toBe("agent");
    expect(currentAttribution().authority).toBe("agent");
  });

  test("the same actor is stamped regardless of which runtime is driving", async () => {
    const { currentAttribution } = await lib();
    process.env.PAL_AGENT = "claude";
    const fromClaude = currentAttribution();
    process.env.PAL_AGENT = "cursor";
    const fromCursor = currentAttribution();
    expect(fromCursor.actor).toBe(fromClaude.actor);
    expect(fromCursor.runtime).not.toBe(fromClaude.runtime);
  });
});

describe("records carry the attribution stamp", () => {
  test("a thread records actor, runtime and authority alongside the machine", async () => {
    const { addThread } = await import("../src/tools/agent/thread");
    const { loadActor } = await lib();
    process.env.PAL_AGENT = "claude";
    const t = addThread("a title", "some context");
    expect(t.actor).toBe(loadActor(HOME).id);
    expect(t.machine.length).toBeGreaterThan(0);
    expect(t.runtime).toBe("claude");
    expect(t.authority).toBe("user");
  });
});
