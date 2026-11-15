import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent, EVENT_FIELDS } from "../src/bronze/events";
import { paths } from "../src/core/paths";
import { reload } from "../src/core/settings";
import {
  algorithmRunsCacheFile,
  loadRunState,
  recordAlgorithmReflection,
  recordAlgorithmTurn,
  recordAlgorithmTurnQuietly,
  turnTexts,
} from "../src/hooks/lib/algorithm-runs";
import { stopTurn } from "../src/hooks/lib/stop";
import { run as reflect } from "../src/tools/agent/algorithm-reflect";
import {
  algorithmReply,
  changes,
  enterNode,
  FORMAT_HEADER,
  inSandbox,
  makeSandbox,
  NATIVE_HEADER,
  prompt,
  type RunSandbox,
  runEvents,
} from "./lib/algorithm-run-fixture";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

const REFLECT_ARGS = ["--task", "t", "--q1", "a", "--q2", "b", "--q3", "c"];
const AT = (minute: number) => new Date(Date.UTC(2026, 10, 15, 10, minute));

function sandbox(): RunSandbox {
  return makeSandbox(freshTestDir(import.meta.file));
}

function cache(): Record<string, unknown> {
  return JSON.parse(readFileSync(algorithmRunsCacheFile(), "utf-8"));
}

function setShellSession(session: string | undefined): void {
  if (session === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = session;
}

async function reflectIn(session: string | undefined): Promise<number> {
  const saved = process.env.CLAUDE_CODE_SESSION_ID;
  setShellSession(session);

  try {
    return await reflect(REFLECT_ARGS);
  } finally {
    setShellSession(saved);
  }
}

function reflectionLines(): number {
  if (!existsSync(paths.reflectionsFile())) return 0;

  return readFileSync(paths.reflectionsFile(), "utf-8").trim().split("\n").length;
}

describe("the event type", () => {
  test("algorithm_run declares every field the stop and the reflection write", () => {
    expect([...EVENT_FIELDS.algorithm_run].map(String).sort()).toEqual(
      [
        "mode",
        "change",
        "run",
        "node",
        "turn",
        "phases",
        "header",
        "headerFirst",
        "startsNew",
        "verdict",
        "source",
      ].sort()
    );
  });
});

describe("recording a turn at stop", () => {
  test("an ALGORITHM turn appends one algorithm_run event with every field", async () => {
    const box = sandbox();
    await inSandbox(box, () => {
      enterNode(box, "n1", "s1");
      const turn = prompt("s1", AT(0));
      recordAlgorithmTurn(
        "s1",
        ["looking", algorithmReply(["OBSERVE", "PLAN"])],
        "transcript",
        AT(1)
      );
      const events = runEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: events[0]?.run,
        ts: AT(1).toISOString(),
        session: "s1",
        type: "algorithm_run",
        change: "turn",
        node: "n1",
        turn,
        phases: ["OBSERVE", "PLAN"],
        header: "pal",
        headerFirst: false,
        startsNew: true,
        verdict: "started",
        source: "transcript",
        mode: "shadow",
      });
      expect(cache()).toEqual({
        open: {
          n1: {
            run: events[0]?.run,
            node: "n1",
            startedAt: AT(1).toISOString(),
            phases: ["OBSERVE", "PLAN"],
          },
        },
        pending: {},
      });
    });
  });

  test("a NATIVE turn appends none", async () => {
    const box = sandbox();
    await inSandbox(box, () => {
      enterNode(box, "n1", "s1");
      prompt("s1", AT(0));
      recordAlgorithmTurn("s1", [`${NATIVE_HEADER}\nok`], "transcript", AT(1));
      expect(runEvents()).toEqual([]);
    });
  });

  test("the final reply alone is recorded as such", async () => {
    const box = sandbox();
    await inSandbox(box, () => {
      enterNode(box, "n1", "s1");
      prompt("s1", AT(0));
      recordAlgorithmTurnQuietly("s1", [algorithmReply(["OBSERVE"])], "final-reply");
      expect(runEvents()[0]).toMatchObject({ source: "final-reply", headerFirst: true });
    });
  });

  test("a stop with no readable transcript records the final reply it was handed", async () => {
    const box = sandbox();
    await inSandbox(box, async () => {
      enterNode(box, "n1", "s1");
      prompt("s1", AT(0));
      await stopTurn({ session_id: "s1", last_assistant_message: "plain" });
      expect(runEvents()).toEqual([]);
      await stopTurn({ session_id: "s1" });
      await stopTurn({
        session_id: "s1",
        last_assistant_message: algorithmReply(["OBSERVE"]),
      });
      expect(runEvents().map((e) => [e.change, e.source, e.session])).toEqual([
        ["turn", "final-reply", "s1"],
      ]);
    });
  });

  test("no session, or the event log turned off: nothing", async () => {
    const box = sandbox();
    await inSandbox(box, () => {
      enterNode(box, "n1", "s1");
      prompt("s1", AT(0));
      recordAlgorithmTurnQuietly(undefined, [algorithmReply(["OBSERVE"])], "transcript");
      writeFileSync(
        resolve(box.home, "memory", "pal-settings.json"),
        JSON.stringify({ eventLog: { enabled: false } })
      );
      reload();
      recordAlgorithmTurn("s1", [algorithmReply(["OBSERVE"])], "transcript", AT(1));
    });
    await inSandbox(box, () => {
      expect(runEvents()).toEqual([]);
      expect(existsSync(algorithmRunsCacheFile())).toBe(false);
    });
  });

  test("an ALGORITHM turn with no active node is no-node and holds nothing open", async () => {
    const box = sandbox();
    await inSandbox(box, () => {
      prompt("s1", AT(0));
      recordAlgorithmTurn("s1", [algorithmReply(["OBSERVE"])], "transcript", AT(1));
      expect(runEvents()[0]).toMatchObject({ verdict: "no-node", node: null });
      expect(cache()).toEqual({ open: {}, pending: {} });
    });
  });

  test("a failing write is logged and swallowed, and the hook goes on", async () => {
    const box = sandbox();
    await inSandbox(box, () => {
      enterNode(box, "n1", "s1");
      prompt("s1", AT(0));
      mkdirSync(algorithmRunsCacheFile(), { recursive: true });
      const texts = [algorithmReply(["OBSERVE"])];
      expect(() => recordAlgorithmTurn("s1", texts, "transcript", AT(1))).toThrow();
      expect(() => recordAlgorithmTurnQuietly("s1", texts, "transcript")).not.toThrow();
    });
  });

  test("over an open run, with and without OBSERVE in the new turn", async () => {
    const box = sandbox();
    await inSandbox(box, () => {
      enterNode(box, "n1", "s1");
      prompt("s1", AT(0));
      recordAlgorithmTurn(
        "s1",
        [algorithmReply(["OBSERVE", "PLAN", "EXECUTE"])],
        "transcript",
        AT(1)
      );
      const second = prompt("s1", AT(2));
      recordAlgorithmTurn("s1", [algorithmReply(["OBSERVE"])], "transcript", AT(3));
      prompt("s1", AT(4));
      recordAlgorithmTurn("s1", [algorithmReply(["EXECUTE"])], "transcript", AT(5));
      const events = runEvents();
      expect(changes()).toEqual(["turn", "superseded", "turn", "superseded", "turn"]);
      expect(events[1]).toMatchObject({ run: events[0]?.run, node: "n1", turn: second });
      expect(
        events.filter((e) => e.change === "turn").map((e) => [e.verdict, e.startsNew])
      ).toEqual([
        ["started", true],
        ["over-open-run", true],
        ["over-open-run", false],
      ]);
    });
  });

  test("two sessions on different nodes do not affect each other", async () => {
    const box = sandbox();
    await inSandbox(box, () => {
      enterNode(box, "n1", "s1");
      enterNode(box, "n2", "s2");
      prompt("s1", AT(0));
      prompt("s2", AT(0));
      recordAlgorithmTurn("s1", [algorithmReply(["OBSERVE"])], "transcript", AT(1));
      recordAlgorithmTurn("s2", [algorithmReply(["OBSERVE"])], "transcript", AT(2));
      expect(runEvents().map((e) => [e.node, e.verdict])).toEqual([
        ["n1", "started"],
        ["n2", "started"],
      ]);
    });
  });

  test("the Output Format header alone records an ALGORITHM turn", async () => {
    const box = sandbox();
    await inSandbox(box, () => {
      enterNode(box, "n1", "s1");
      prompt("s1", AT(0));
      recordAlgorithmTurn(
        "s1",
        [algorithmReply(["OBSERVE"], FORMAT_HEADER)],
        "transcript",
        AT(1)
      );
      expect(runEvents()[0]).toMatchObject({ change: "turn", header: "format" });
    });
  });
});

describe("reflections", () => {
  test("a one-prompt run with a reflection ends finished and leaves no open run", async () => {
    const box = sandbox();
    await inSandbox(box, async () => {
      enterNode(box, "n1", "s1");
      const turn = prompt("s1", AT(0));
      expect(await reflectIn("s1")).toBe(0);
      expect(cache()).toMatchObject({ pending: { [turn]: { turn, node: "n1" } } });
      recordAlgorithmTurn(
        "s1",
        [algorithmReply(["OBSERVE", "LEARN"])],
        "transcript",
        AT(1)
      );
      const events = runEvents();
      expect(changes()).toEqual(["reflected", "turn", "finished"]);
      expect(events[0]).toMatchObject({
        node: "n1",
        turn,
        session: "s1",
        mode: "shadow",
      });
      expect(events[2]).toMatchObject({
        run: events[1]?.run,
        node: "n1",
        turn,
        mode: "shadow",
      });
      expect(cache()).toEqual({ open: {}, pending: {} });
    });
  });

  test("a reflected ALGORITHM turn over an open run: over-open-run, superseded, finished", async () => {
    const box = sandbox();
    await inSandbox(box, async () => {
      enterNode(box, "n1", "s1");
      prompt("s1", AT(0));
      recordAlgorithmTurn("s1", [algorithmReply(["OBSERVE"])], "transcript", AT(1));
      prompt("s1", AT(2));
      await reflectIn("s1");
      recordAlgorithmTurn(
        "s1",
        [algorithmReply(["OBSERVE", "LEARN"])],
        "transcript",
        AT(3)
      );
      const events = runEvents();
      expect(changes()).toEqual(["turn", "reflected", "superseded", "turn", "finished"]);
      expect(events[2]?.run).toBe(events[0]?.run);
      expect(events[3]?.verdict).toBe("over-open-run");
      expect(events[4]?.run).toBe(events[3]?.run);
      expect(cache()).toEqual({ open: {}, pending: {} });
    });
  });

  test("a reflection in a later turn in another mode finishes the open run", async () => {
    const box = sandbox();
    await inSandbox(box, async () => {
      enterNode(box, "n1", "s1");
      prompt("s1", AT(0));
      recordAlgorithmTurn(
        "s1",
        [algorithmReply(["OBSERVE", "PLAN"])],
        "transcript",
        AT(1)
      );
      const later = prompt("s1", AT(2));
      await reflectIn("s1");
      recordAlgorithmTurn("s1", ["━━━ 📚 LEARN ━━━ 5/5\nreflected"], "transcript", AT(3));
      const events = runEvents();
      expect(changes()).toEqual(["turn", "reflected", "finished"]);
      expect(events[2]).toMatchObject({
        run: events[0]?.run,
        turn: later,
        phases: ["LEARN"],
      });
      expect(cache()).toEqual({ open: {}, pending: {} });
    });
  });

  test("a reflection with no run changes no run and stays waiting", async () => {
    const box = sandbox();
    await inSandbox(box, async () => {
      enterNode(box, "n1", "s1");
      const turn = prompt("s1", AT(0));
      await reflectIn("s1");
      recordAlgorithmTurn("s1", ["plain answer"], "transcript", AT(1));
      expect(changes()).toEqual(["reflected"]);
      expect(Object.keys(cache().pending as object)).toEqual([turn]);
    });
  });

  test("a cache deleted between the reflection and the stop still finishes the run", async () => {
    const box = sandbox();
    await inSandbox(box, async () => {
      enterNode(box, "n1", "s1");
      prompt("s1", new Date());
      await reflectIn("s1");
      removeOnceReleased(algorithmRunsCacheFile());
      recordAlgorithmTurn("s1", [algorithmReply(["OBSERVE"])], "transcript");
      expect(changes()).toEqual(["reflected", "turn", "finished"]);
    });
  });

  test("no known session: no event, and the reflection is written as today", async () => {
    const box = sandbox();
    await inSandbox(box, async () => {
      prompt("s1", AT(0));
      expect(await reflectIn(undefined)).toBe(0);
      expect(reflectionLines()).toBe(1);
      expect(runEvents()).toEqual([]);
    });
  });

  test("a session with no logged turn: no event", async () => {
    const box = sandbox();
    await inSandbox(box, async () => {
      expect(await reflectIn("s-new")).toBe(0);
      recordAlgorithmReflection(undefined);
      expect(reflectionLines()).toBe(1);
      expect(runEvents()).toEqual([]);
    });
  });
});

describe("the cache", () => {
  test("a deleted file is rebuilt to the same content from the events", async () => {
    const box = sandbox();
    await inSandbox(box, async () => {
      const now = new Date();
      enterNode(box, "n1", "s1");
      enterNode(box, "n2", "s2");
      prompt("s1", now);
      recordAlgorithmTurn("s1", [algorithmReply(["OBSERVE", "PLAN"])], "transcript", now);
      prompt("s2", now);
      await reflectIn("s2");
      const written = readFileSync(algorithmRunsCacheFile(), "utf-8");
      expect(Object.keys(JSON.parse(written).open)).toEqual(["n1"]);
      removeOnceReleased(algorithmRunsCacheFile());
      expect(loadRunState(now)).toEqual(JSON.parse(written));
      expect(readFileSync(algorithmRunsCacheFile(), "utf-8")).toBe(written);
    });
  });
});

describe("reading the cache", () => {
  const OPEN = {
    run: "rx",
    node: "nx",
    startedAt: "2026-11-15T10:00:00.000Z",
    phases: [],
  };

  function writeCacheFile(content: string): void {
    mkdirSync(paths.cache(), { recursive: true });
    writeFileSync(algorithmRunsCacheFile(), content);
  }

  function seedOpenRun(node: string, daysAgo: number, now: Date): void {
    const ts = new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
    appendEvent(
      "algorithm_run",
      { change: "turn", run: `r-${node}`, node, turn: `t-${node}` },
      { id: `r-${node}`, ts }
    );
  }

  test("a valid cache is used as it is", async () => {
    await inSandbox(sandbox(), () => {
      writeCacheFile(JSON.stringify({ open: { nx: OPEN }, pending: {} }));
      expect(loadRunState()).toEqual({ open: { nx: OPEN }, pending: {} });
    });
  });

  test("a cache that is not JSON or lacks a part is rebuilt from the events", async () => {
    await inSandbox(sandbox(), () => {
      const now = new Date();
      seedOpenRun("n1", 0, now);

      for (const content of [
        "not json",
        "null",
        JSON.stringify({ open: { nx: OPEN } }),
        JSON.stringify({ pending: {} }),
      ]) {
        writeCacheFile(content);
        expect(Object.keys(loadRunState(now).open)).toEqual(["n1"]);
      }
    });
  });

  test("the rebuild replays the last 30 days", async () => {
    await inSandbox(sandbox(), () => {
      const now = new Date();
      seedOpenRun("recent", 29, now);
      seedOpenRun("old", 31, now);
      expect(Object.keys(loadRunState(now).open)).toEqual(["recent"]);
    });
  });

  test("a turn in another mode with no logged turn reads and writes no cache", async () => {
    const box = sandbox();
    await inSandbox(box, () => {
      recordAlgorithmTurn("s1", ["plain"], "transcript");
      expect(existsSync(algorithmRunsCacheFile())).toBe(false);
    });
  });

  test("a turn in another mode that was not reflected leaves the cache untouched", async () => {
    const box = sandbox();
    await inSandbox(box, () => {
      prompt("s1", AT(0));
      const stale = { old: { turn: "old", node: "n1", at: "2026-01-01T00:00:00.000Z" } };
      writeCacheFile(JSON.stringify({ open: {}, pending: stale }));
      recordAlgorithmTurn("s1", ["plain"], "transcript", AT(1));
      expect(cache()).toEqual({ open: {}, pending: stale });
    });
  });
});

describe("failures are logged under the event type", () => {
  function debugLog(): string {
    return readFileSync(resolve(paths.debug(), "debug.log"), "utf-8");
  }

  test("at stop", async () => {
    const box = sandbox();
    await inSandbox(box, () => {
      enterNode(box, "n1", "s1");
      prompt("s1", AT(0));
      mkdirSync(algorithmRunsCacheFile(), { recursive: true });
      recordAlgorithmTurnQuietly("s1", [algorithmReply(["OBSERVE"])], "transcript");
      expect(debugLog()).toContain("ERROR events:algorithm_run:");
    });
  });

  test("at a reflection, which is still written", async () => {
    const box = sandbox();
    await inSandbox(box, async () => {
      prompt("s1", AT(0));
      mkdirSync(algorithmRunsCacheFile(), { recursive: true });
      expect(await reflectIn("s1")).toBe(0);
      expect(reflectionLines()).toBe(1);
      expect(debugLog()).toContain("ERROR events:algorithm_run:");
    });
  });

  test("a reflection with the event log turned off writes no cache", async () => {
    const box = sandbox();
    await inSandbox(box, async () => {
      prompt("s1", AT(0));
      writeFileSync(
        resolve(box.home, "memory", "pal-settings.json"),
        JSON.stringify({ eventLog: { enabled: false } })
      );
      reload();
      expect(await reflectIn("s1")).toBe(0);
      expect(existsSync(algorithmRunsCacheFile())).toBe(false);
    });
  });
});

describe("the turn's texts", () => {
  test("the assistant texts after the last user message, in order", () => {
    expect(
      turnTexts([
        { role: "user", content: "first" },
        { role: "assistant", content: "old" },
        { role: "user", content: "second" },
        { role: "assistant", content: "a" },
        { role: "system", content: "x" },
        { role: "assistant", content: "b" },
      ])
    ).toEqual(["a", "b"]);
  });

  test("every assistant text when no user message is in view", () => {
    expect(turnTexts([{ role: "assistant", content: "a" }])).toEqual(["a"]);
  });
});
