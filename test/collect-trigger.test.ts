import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectDue, markCollected } from "../src/hooks/lib/collect-trigger";
import { agentDirOverrides } from "../src/hooks/lib/paths";
import { reload } from "../src/hooks/lib/settings";
import { collectEvents } from "../src/tools/lib/collectors";
import { freshTestDir } from "./lib/test-home";

let home: string;
const T0 = Date.parse("2026-10-12T10:00:00.000Z");
const MINUTE = 60_000;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  for (const { env } of agentDirOverrides()) process.env[env] = resolve(home, env);
  process.env.XDG_DATA_HOME = resolve(home, "data");
  mkdirSync(resolve(home, "memory", "state"), { recursive: true });
  reload();
});

describe("when session stop collects", () => {
  test("a first collect is always due", () => {
    expect(collectDue(T0)).toBe(true);
  });

  test("a collect is not due again for a quarter hour", () => {
    markCollected(T0);
    expect(collectDue(T0 + 14 * MINUTE)).toBe(false);
    expect(collectDue(T0 + 15 * MINUTE)).toBe(true);
  });

  test("a collect run marks itself, so stop does not start another right after", () => {
    collectEvents(T0);
    expect(collectDue(T0 + MINUTE)).toBe(false);
  });
});

describe("one collect at a time", () => {
  const lock = () => resolve(home, "memory", "state", "collect.lock");

  test("a collect already running holds off a second one", () => {
    writeFileSync(lock(), "123");
    expect(collectEvents(Date.now())).toBeNull();
  });

  test("a lock left behind by a crashed collect is taken over", () => {
    writeFileSync(lock(), "123");
    const old = (Date.now() - 11 * MINUTE) / 1000;
    utimesSync(lock(), old, old);
    expect(collectEvents(Date.now())).not.toBeNull();
  });

  test("the lock is released when the collect ends", () => {
    collectEvents(Date.now());
    expect(collectEvents(Date.now())).not.toBeNull();
  });
});
