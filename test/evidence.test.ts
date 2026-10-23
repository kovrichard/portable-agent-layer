import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evidenceCommand } from "../src/cli/evidence";
import { appendEvent, eventsSince } from "../src/hooks/lib/events";
import {
  contentFor,
  exclusions,
  forget,
  unforget,
  userTurnsSince,
} from "../src/hooks/lib/evidence";
import { observeTurn, recordReply } from "../src/hooks/lib/interaction";
import { reload } from "../src/hooks/lib/settings";
import { runCommand } from "../src/tools/lib/command";
import { freshTestDir } from "./lib/test-home";

let home: string;
const T0 = new Date("2026-09-10T10:00:00Z");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  mkdirSync(resolve(home, "memory"), { recursive: true });
  writeFileSync(resolve(home, "memory", "pal-settings.json"), "{}");
  reload();
});

function exchange(prompt: string, reply: string, session = "s1", start = T0) {
  observeTurn(prompt, session, start);
  recordReply(session, reply, new Date(start.getTime() + 10_000));
}

const storeFile = (month: string) =>
  resolve(home, "memory", "content", "events", `${month}.jsonl`);

describe("the evidence read", () => {
  test("a turn comes with its text and the reply it got", () => {
    exchange("rename the helper please", "renamed it");

    const [turn] = userTurnsSince(T0);
    expect(turn).toMatchObject({
      session: "s1",
      runtime: "claude",
      text: "rename the helper please",
      pastedChars: 0,
      reply: { text: "renamed it" },
    });
  });

  test("turns before the window are left out", () => {
    exchange("rename the helper please", "renamed it");
    expect(userTurnsSince(at(5))).toEqual([]);
  });

  test("a turn with no stored text and no paste count reads as null", () => {
    appendEvent("turn", { words: 3 }, { ts: T0.toISOString(), session: "s1" });
    expect(userTurnsSince(T0)).toEqual([
      expect.objectContaining({ text: null, pastedChars: null, reply: null }),
    ]);
  });

  test("a turn no human drove is not evidence", () => {
    appendEvent(
      "turn",
      { words: 3 },
      {
        ts: T0.toISOString(),
        session: "s1",
        attribution: { authority: "agent" },
        content: { prompt: "spawned" },
      }
    );
    expect(userTurnsSince(T0)).toEqual([]);
  });

  test("a stray file beside the store is not read", () => {
    exchange("rename the helper please", "renamed it");
    const [turn] = userTurnsSince(T0);
    writeFileSync(
      `${storeFile("2026-09")}.tmp`,
      `${JSON.stringify({ id: turn.id, prompt: "stale copy" })}\n`
    );
    expect(contentFor(turn.id)).toMatchObject({ prompt: "rename the helper please" });
  });

  test("contentFor returns the stored text by event id", () => {
    exchange("rename the helper please", "renamed it");
    const [turn] = userTurnsSince(T0);
    expect(contentFor(turn.id)).toMatchObject({ prompt: "rename the helper please" });
    expect(contentFor("no-such-id")).toBeNull();
  });
});

describe("forget", () => {
  test("keeps the turn out of every read, and its text as it was", () => {
    exchange("my secret plan for friday", "noted");
    const [turn] = userTurnsSince(T0);

    expect(forget(turn.id)).toBe(true);

    expect(userTurnsSince(T0)).toEqual([]);
    expect(contentFor(turn.id)).toMatchObject({ prompt: "my secret plan for friday" });
    expect(readFileSync(storeFile("2026-09"), "utf-8")).toContain("secret plan");
  });

  test("unforget makes the turn evidence again", () => {
    exchange("my secret plan for friday", "noted");
    const [turn] = userTurnsSince(T0);
    forget(turn.id);

    expect(unforget(turn.id)).toBe(true);

    expect(userTurnsSince(T0)).toEqual([turn]);
    expect(exclusions()).toEqual([]);
  });

  test("with the event log off, forget and unforget refuse instead of claiming success", () => {
    exchange("rename the helper please", "renamed it");
    const [turn] = userTurnsSince(T0);
    forget(turn.id);
    writeFileSync(
      resolve(home, "memory", "pal-settings.json"),
      JSON.stringify({ eventLog: { enabled: false } })
    );
    reload();

    expect(forget(turn.reply?.id as string)).toBe(false);
    expect(unforget(turn.id)).toBe(false);
  });

  test("unforget refuses an id that is not forgotten", () => {
    exchange("rename the helper please", "renamed it");
    const [turn] = userTurnsSince(T0);
    expect(unforget(turn.id)).toBe(false);
    expect(eventsSince("forgotten", new Date(0))).toEqual([]);
  });

  test("the latest forget or unforget decides, and both stay in the log", () => {
    exchange("rename the helper please", "renamed it");
    const [turn] = userTurnsSince(T0);
    forget(turn.id);
    unforget(turn.id);
    forget(turn.id);

    expect(exclusions()).toEqual([{ id: turn.id, since: expect.any(String) }]);
    expect(eventsSince("forgotten", new Date(0)).map((e) => e.undone)).toEqual([
      false,
      true,
      false,
    ]);
  });

  test("leaves the other turns and their text as they were", () => {
    exchange("my secret plan for friday", "noted");
    exchange("rename the helper please", "renamed it", "s2", at(60));
    const [secret] = userTurnsSince(T0);

    forget(secret.id);

    expect(userTurnsSince(T0)).toEqual([
      expect.objectContaining({
        text: "rename the helper please",
        reply: expect.objectContaining({ text: "renamed it" }),
      }),
    ]);
  });

  test("a forgotten reply leaves its turn, without the reply text", () => {
    exchange("rename the helper please", "my secret reply");
    const [turn] = userTurnsSince(T0);

    forget(turn.reply?.id as string);

    expect(userTurnsSince(T0)).toEqual([
      expect.objectContaining({
        text: "rename the helper please",
        reply: expect.objectContaining({ text: null }),
      }),
    ]);
  });

  test("finds the turn in an older month", () => {
    exchange("an august request", "done", "s1", new Date("2026-08-20T10:00:00Z"));
    exchange("a september request", "done");
    const [august] = userTurnsSince(new Date("2026-08-01T00:00:00Z"));

    expect(forget(august.id)).toBe(true);
    expect(userTurnsSince(new Date("2026-08-01T00:00:00Z"))).toEqual([
      expect.objectContaining({ text: "a september request" }),
    ]);
  });

  test("an unknown id forgets nothing and records nothing", () => {
    exchange("rename the helper please", "renamed it");
    expect(forget("no-such-id")).toBe(false);
    expect(userTurnsSince(T0)).toHaveLength(1);
    expect(eventsSince("forgotten", new Date(0))).toEqual([]);
  });
});

describe("pal cli evidence", () => {
  let printed: string[];

  beforeEach(() => {
    mock.restore();
    printed = [];
    spyOn(console, "log").mockImplementation((line: unknown) => {
      printed.push(String(line));
    });
    spyOn(console, "error").mockImplementation(() => {});
  });

  const run = (...args: string[]) =>
    runCommand(evidenceCommand, args, ["pal", "cli", "evidence"]);

  test("turns prints one line per turn, its text on one line, then the count", async () => {
    exchange(`first line\n\n   second ${"x".repeat(200)}`, "ok");
    const [turn] = userTurnsSince(T0);

    expect(await run("turns", "--days", "3650")).toBe(0);

    expect(printed).toEqual([
      `${turn.ts}  ${turn.id}  ${`first line second ${"x".repeat(200)}`.slice(0, 100)}`,
      "1 turns",
    ]);
  });

  test("a turn without text says so", async () => {
    appendEvent("turn", { words: 3 }, { ts: T0.toISOString(), session: "s1" });
    await run("turns", "--days", "3650");
    expect(printed[0]).toEndWith("  (no text)");
  });

  test("turns --json prints the turns as JSON", async () => {
    exchange("rename the helper please", "renamed it");
    await run("turns", "--days", "3650", "--json");
    expect(JSON.parse(printed.join("\n"))).toEqual(userTurnsSince(T0));
  });

  test("show prints the stored row, and fails on an unknown id", async () => {
    exchange("rename the helper please", "renamed it");
    const [turn] = userTurnsSince(T0);

    expect(await run("show", turn.id)).toBe(0);
    expect(JSON.parse(printed.join("\n"))).toEqual(contentFor(turn.id));
    expect(await run("show", "no-such-id")).not.toBe(0);
  });

  test("forget reports what it forgot, and fails on an unknown id", async () => {
    exchange("rename the helper please", "renamed it");
    const [turn] = userTurnsSince(T0);

    expect(await run("forget", turn.id)).toBe(0);
    expect(printed).toEqual([
      `Forgot ${turn.id}; its text is kept, undo with: pal cli evidence unforget ${turn.id}`,
    ]);
    expect(await run("forget", "no-such-id")).not.toBe(0);
  });

  test("forgotten lists each forgotten turn and reply with its text", async () => {
    exchange("rename the helper please", "renamed it");
    const [turn] = userTurnsSince(T0);
    forget(turn.id);
    forget(turn.reply?.id as string);
    const [first, second] = exclusions();

    expect(await run("forgotten")).toBe(0);

    expect(printed).toEqual([
      `${first.since}  ${turn.id}  rename the helper please`,
      `${second.since}  ${turn.reply?.id}  renamed it`,
      "2 forgotten",
    ]);
  });

  test("unforget reports it, and fails on an id that is not forgotten", async () => {
    exchange("rename the helper please", "renamed it");
    const [turn] = userTurnsSince(T0);
    forget(turn.id);

    expect(await run("unforget", turn.id)).toBe(0);
    expect(printed).toEqual([`${turn.id} counts as evidence again`]);
    expect(await run("unforget", turn.id)).not.toBe(0);
  });
});
