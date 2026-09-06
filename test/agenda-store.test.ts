import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { agendaPath, readAgenda, writeAgenda } from "../src/hooks/lib/agenda-store";

// The page reads this file and never writes it, so a half-written or hand-edited
// agenda must read as "nothing yet" rather than crash the morning screen.

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-agenda-store-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

function writeRaw(content: string): void {
  mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
  writeFileSync(resolve(HOME, "memory", "state", "agenda.json"), content, "utf-8");
}

describe("agendaPath", () => {
  test("it lives in the state directory of the active home", () => {
    expect(agendaPath()).toBe(resolve(HOME, "memory", "state", "agenda.json"));
  });
});

describe("readAgenda", () => {
  test("no file is null", () => {
    expect(readAgenda()).toBeNull();
  });

  test("unparseable JSON is null, not a throw", () => {
    writeRaw("{ this is not json");
    expect(readAgenda()).toBeNull();
  });

  test("valid JSON of the wrong shape is null", () => {
    writeRaw(JSON.stringify({ moves: "three of them" }));
    expect(readAgenda()).toBeNull();
    writeRaw(JSON.stringify({ moves: [] }));
    expect(readAgenda()).toBeNull();
  });

  test("an empty move list is still an agenda when it is dated", () => {
    writeRaw(JSON.stringify({ generatedAt: "2026-09-05T06:00:00.000Z", moves: [] }));
    expect(readAgenda()?.moves).toEqual([]);
  });
});

describe("writeAgenda", () => {
  test("round-trips through the file", async () => {
    mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
    const agenda = {
      generatedAt: "2026-09-05T06:00:00.000Z",
      moves: [{ move: "Send the one-pager", because: "waiting on you since Tuesday" }],
    };
    await writeAgenda(agenda);
    expect(readAgenda()).toEqual(agenda);
  });
});
