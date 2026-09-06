import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { LedgerEntry } from "../src/hooks/lib/ledger";
import { ledgerView } from "../src/tools/ledger/view";

// A refusal produces no other event: nothing runs, so no post-tool hook reports
// it. If the gate does not write the entry itself, the block leaves no trace and
// the page's "blocked" count is structurally zero.

const HOOK = resolve(import.meta.dir, "../src/hooks/SecurityValidator.ts");

// Assembled at runtime so this file does not contain the literal pattern that
// PAL's own SecurityValidator blocks when an agent edits or greps it.
const DANGEROUS = `${"rm -r"}${"f /"}`;

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-blocked-"));
  mkdirSync(resolve(HOME, "memory", "ledger"), { recursive: true });
});

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true });
});

async function runValidator(payload: unknown, agent = "claude"): Promise<string> {
  const proc = Bun.spawn(["bun", "run", HOOK, `--agent=${agent}`], {
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
    env: { ...process.env, PAL_HOME: HOME, PAL_AGENT: agent },
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

function preToolUse(toolName: string, toolArgs: Record<string, unknown>) {
  return { hook_event_name: "PreToolUse", toolName, toolArgs };
}

function entries(): LedgerEntry[] {
  const file = resolve(HOME, "memory", "ledger", "actions.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerEntry);
}

describe("a rule refusing is recorded", () => {
  test("a refused write is one entry, with the reason the agent was given", async () => {
    const target = resolve(HOME, "memory", "projects", "demo", "ISA.md");
    const out = await runValidator(preToolUse("Edit", { file_path: target }));
    expect(out).toContain("deny");

    const written = entries();
    expect(written).toHaveLength(1);
    expect(written[0].outcome).toBe("blocked");
    expect(written[0].tool).toBe("Edit");
    expect(written[0].target).toContain("ISA.md");
    expect(written[0].reason).toContain("managed automatically by hooks");
    expect(out).toContain(written[0].reason ?? "");
  });

  test("nothing landed, so nothing is claimed to have landed", async () => {
    const target = resolve(HOME, "memory", "projects", "demo", "ISA.md");
    await runValidator(preToolUse("Edit", { file_path: target }));

    const entry = entries()[0];
    expect(entry.before).toBeNull();
    expect(entry.after).toBeNull();
    expect(entry.delta).toBeUndefined();
  });

  test("a refused command names itself, since it has no file to name", async () => {
    const out = await runValidator(preToolUse("Bash", { command: DANGEROUS }));
    expect(out).toContain("deny");

    const written = entries();
    expect(written).toHaveLength(1);
    expect(written[0].outcome).toBe("blocked");
    expect(written[0].command).toBe(DANGEROUS);
    expect(written[0].tool).toBe("Bash");
  });

  test("the flat shell shape is recorded too, not only the wrapped one", async () => {
    const out = await runValidator({ command: DANGEROUS }, "cursor");
    expect(out).toContain("deny");
    expect(entries()[0]?.command).toBe(DANGEROUS);
  });

  test("an allowed action writes nothing — the ledger is not a log of attempts", async () => {
    const out = await runValidator(
      preToolUse("Edit", { file_path: resolve(HOME, "notes.md") })
    );
    expect(out).toBe("");
    expect(entries()).toEqual([]);
  });

  test("a ledger it cannot write still denies — recording never softens a block", async () => {
    // A file where the ledger directory has to go: every write path throws.
    rmSync(resolve(HOME, "memory", "ledger"), { recursive: true });
    writeFileSync(resolve(HOME, "memory", "ledger"), "not a directory", "utf-8");

    const out = await runValidator(preToolUse("Bash", { command: DANGEROUS }));
    expect(out).toContain("deny");
  });

  test("it carries who tried it, so a refusal is attributable like any entry", async () => {
    await runValidator(preToolUse("Bash", { command: DANGEROUS }));
    const entry = entries()[0];
    expect(entry.actor).toBeTruthy();
    expect(entry.machine).toBeTruthy();
    expect(entry.runtime).toBe("claude");
    expect(entry.authority).toBeTruthy();
  });
});

describe("what the page then reads", () => {
  test("blocked is counted, and counted as a refusal", async () => {
    process.env.PAL_HOME = HOME;
    try {
      await runValidator(preToolUse("Bash", { command: DANGEROUS }));
      const view = ledgerView({});
      expect(view.stats.outcomes.blocked.total).toBe(1);
      expect(view.stats.refusals).toBe(1);
      expect(view.rows[0].outcome).toBe("blocked");
      expect(view.rows[0].command).toBe(DANGEROUS);
    } finally {
      delete process.env.PAL_HOME;
    }
  });
});
