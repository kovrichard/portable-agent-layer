import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { refreshAgenda } from "../src/hooks/handlers/agenda";
import { readAgenda } from "../src/hooks/lib/agenda-store";
import { canInfer } from "../src/hooks/lib/inference";

// The only model call behind the morning screen. Both gates in front of it are
// pinned here: an agenda written a few hours ago is not rewritten, and a runtime
// with nothing to infer with leaves the file alone rather than clearing it.

const NOW = new Date("2026-09-05T12:00:00.000Z");
const PRESERVED = ["PAL_AGENT", "PAL_ANTHROPIC_API_KEY", "PAL_OPENAI_API_KEY", "PATH"];

let HOME: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(PRESERVED.map((k) => [k, process.env[k]]));
  HOME = mkdtempSync(resolve(tmpdir(), "pal-agenda-handler-"));
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
});

afterEach(() => {
  for (const k of PRESERVED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

/** An agent with no binary on an empty PATH and no keys: nothing can be asked. */
function withoutInference(): void {
  const empty = mkdtempSync(resolve(tmpdir(), "pal-agenda-nopath-"));
  process.env.PATH = empty;
  process.env.PAL_AGENT = "opencode";
  delete process.env.PAL_ANTHROPIC_API_KEY;
  delete process.env.PAL_OPENAI_API_KEY;
}

function writeAgendaFile(generatedAt: string): void {
  writeFileSync(
    resolve(HOME, "memory", "state", "agenda.json"),
    JSON.stringify({ generatedAt, moves: [{ move: "the old move", because: "then" }] }),
    "utf-8"
  );
}

describe("refreshAgenda", () => {
  test("an agenda written hours ago is left alone", async () => {
    writeAgendaFile("2026-09-05T09:00:00.000Z");
    expect(await refreshAgenda(NOW)).toBe("fresh");
    expect(readAgenda()?.moves[0].move).toBe("the old move");
  });

  test("yesterday's agenda is not fresh", async () => {
    withoutInference();
    writeAgendaFile("2026-09-04T09:00:00.000Z");
    expect(await refreshAgenda(NOW)).not.toBe("fresh");
  });

  test("a runtime that cannot infer stops before spending anything", async () => {
    withoutInference();
    expect(canInfer()).toBe(false);
    expect(await refreshAgenda(NOW)).toBe("no-inference");
  });

  test("it keeps yesterday's moves rather than blanking them", async () => {
    withoutInference();
    writeAgendaFile("2026-09-04T09:00:00.000Z");
    await refreshAgenda(NOW);
    expect(readAgenda()?.moves[0].move).toBe("the old move");
  });

  test("an unreadable agenda is treated as none, not as fresh", async () => {
    withoutInference();
    writeFileSync(resolve(HOME, "memory", "state", "agenda.json"), "{{{", "utf-8");
    expect(await refreshAgenda(NOW)).toBe("no-inference");
  });
});
