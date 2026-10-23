import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { contentFor, forget, userTurnsSince } from "../src/hooks/lib/evidence";
import { observeTurn, recordReply } from "../src/hooks/lib/interaction";
import { reload } from "../src/hooks/lib/settings";
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

function oneExchange(prompt: string, reply: string) {
  observeTurn(prompt, "s1", T0);
  recordReply("s1", reply, at(10));
}

describe("the evidence read", () => {
  test("a turn comes with its text and the reply it got", () => {
    oneExchange("rename the helper please", "renamed it");

    const [turn] = userTurnsSince(T0);
    expect(turn).toMatchObject({
      session: "s1",
      runtime: "claude",
      text: "rename the helper please",
      reply: { text: "renamed it" },
    });
  });

  test("turns before the window are left out", () => {
    oneExchange("rename the helper please", "renamed it");
    expect(userTurnsSince(at(5))).toEqual([]);
  });

  test("contentFor returns the stored text by event id", () => {
    oneExchange("rename the helper please", "renamed it");
    const [turn] = userTurnsSince(T0);
    expect(contentFor(turn.id)).toMatchObject({ prompt: "rename the helper please" });
    expect(contentFor("no-such-id")).toBeNull();
  });
});

describe("forget", () => {
  test("removes the turn from every read and its text from the content store", () => {
    oneExchange("my secret plan for friday", "noted");
    const [turn] = userTurnsSince(T0);

    expect(forget(turn.id)).toBe(true);

    expect(userTurnsSince(T0)).toEqual([]);
    expect(contentFor(turn.id)).toMatchObject({ id: turn.id, forgotten: true });
    const store = resolve(home, "memory", "content", "events", "2026-09.jsonl");
    expect(readFileSync(store, "utf-8")).not.toContain("secret plan");
  });

  test("leaves a tombstone event naming what was forgotten", () => {
    oneExchange("my secret plan for friday", "noted");
    const [turn] = userTurnsSince(T0);
    forget(turn.id);

    const month = new Date().toISOString().slice(0, 7);
    const log = readFileSync(
      resolve(home, "memory", "events", `${month}.jsonl`),
      "utf-8"
    );
    expect(log).toContain(`"type":"forgotten","session":null`);
    expect(log).toContain(`"target":"${turn.id}"`);
  });

  test("an unknown id forgets nothing and records nothing", () => {
    oneExchange("rename the helper please", "renamed it");
    expect(forget("no-such-id")).toBe(false);
    expect(userTurnsSince(T0)).toHaveLength(1);
  });
});
