import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HOME = resolve(import.meta.dir, "../.test-home-thread-build");

beforeEach(() => {
  process.env.PAL_HOME = HOME;
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  mkdirSync(HOME, { recursive: true });
});

afterEach(() => {
  delete process.env.PAL_HOME;
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

async function lib() {
  return await import("../src/tools/lib/thread");
}

describe("addThread", () => {
  test("stamps this machine's id", async () => {
    const { addThread } = await lib();
    const t = addThread("a title", "some context");
    const machineFile = JSON.parse(readFileSync(resolve(HOME, "machine.json"), "utf-8"));
    expect(t.machine).toBe(machineFile.id);
  });

  test("anchors the cwd when it falls inside a registered project", async () => {
    const slug = "test-repo";
    const dir = resolve(HOME, "memory", "projects", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "ISA.md"),
      `---\nname: "${slug}"\npath: "${process.cwd()}"\nstatus: "active"\ncreated: "2026-01-01"\nupdated: "2026-01-01"\n---\n\n## Goal\n`
    );
    const { addThread } = await lib();
    const t = addThread("a title", "some context");
    expect(t.cwd).toBe(`{proj:${slug}}`);
  });

  test("passes the cwd through unchanged when no project is registered", async () => {
    const { addThread } = await lib();
    const t = addThread("a title", "some context");
    expect(t.cwd).toBe(process.cwd());
  });

  test("persists the stamped thread to threads.jsonl", async () => {
    const { addThread } = await lib();
    const t = addThread("a title", "some context");
    const lines = readFileSync(resolve(HOME, "memory", "state", "threads.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe(t.id);
    expect(lines[0].machine).toBe(t.machine);
  });

  test("starts a new thread as open with no resolved timestamp", async () => {
    const { addThread } = await lib();
    const t = addThread("a title", "some context");
    expect(t.status).toBe("open");
    expect(t.resolved).toBeNull();
  });
});

const NOW = new Date("2026-09-06T12:00:00.000Z");
const LATER = new Date("2026-09-07T09:30:00.000Z");

async function threads(...titles: string[]) {
  const { newThread } = await lib();
  return titles.map((title, i) => ({
    ...newThread(title, `context ${i}`, NOW, "/work"),
    id: `id-${i}`,
  }));
}

describe("newId", () => {
  test("orders by time — a later thread sorts after an earlier one", async () => {
    const { newId } = await lib();
    const early = newId(new Date("2026-01-01").getTime(), () => 0.5);
    const late = newId(new Date("2026-06-01").getTime(), () => 0.5);
    expect(early < late).toBe(true);
  });

  // Two threads opened in the same millisecond still get their own id.
  test("two ids from the same millisecond differ", async () => {
    const { newId } = await lib();
    const at = Date.now();
    expect(newId(at, () => 0.111)).not.toBe(newId(at, () => 0.999));
  });

  // Three characters of the base-36 expansion — which is all of it when the
  // fraction happens to be short, as 0.5 is.
  test("the id is the timestamp followed by up to three random characters", async () => {
    const { newId } = await lib();
    const stamp = (1_000_000).toString(36);
    expect(newId(1_000_000, () => 0.123456789)).toBe(`${stamp}4fz`);
    expect(newId(1_000_000, () => 0.5)).toBe(`${stamp}i`);
  });
});

describe("newThread", () => {
  test("stamps the clock and the directory it was handed", async () => {
    const { newThread } = await lib();
    const t = newThread("t", "c", NOW, "/somewhere/else");
    expect(t.created).toBe("2026-09-06T12:00:00.000Z");
    expect(t.cwd).toBe("/somewhere/else");
  });

  test("carries the title and context through", async () => {
    const { newThread } = await lib();
    const t = newThread("the question", "why it matters", NOW, "/work");
    expect(t.title).toBe("the question");
    expect(t.context).toBe("why it matters");
  });

  // Building a thread is not filing one.
  test("does not touch the store", async () => {
    const { newThread, readThreads } = await lib();
    newThread("t", "c", NOW, "/work");
    expect(readThreads()).toEqual([]);
  });
});

describe("parseThreads", () => {
  test("reads one thread per line", async () => {
    const { parseThreads, serializeThreads } = await lib();
    const store = await threads("first", "second");
    expect(parseThreads(serializeThreads(store))).toEqual(store);
  });

  // A line of spaces is as blank as an empty one, and JSON.parse would choke on it.
  test("skips blank and whitespace-only lines", async () => {
    const { parseThreads } = await lib();
    const [one] = await threads("only");
    expect(parseThreads(`\n   \n${JSON.stringify(one)}\n\n  \n`)).toEqual([one]);
  });

  // One bad line loses the store, not just the line.
  test("a malformed line yields nothing rather than throwing", async () => {
    const { parseThreads } = await lib();
    const [one] = await threads("only");
    expect(parseThreads(`${JSON.stringify(one)}\n{oops`)).toEqual([]);
  });
});

describe("serializeThreads", () => {
  test("ends on a newline so the next append starts a line", async () => {
    const { serializeThreads } = await lib();
    expect(serializeThreads(await threads("a", "b")).endsWith("\n")).toBe(true);
  });

  test("writes one line per thread", async () => {
    const { serializeThreads } = await lib();
    const text = serializeThreads(await threads("a", "b"));
    expect(text.trimEnd().split("\n")).toHaveLength(2);
  });
});

describe("readThreads / writeThreads", () => {
  test("a store that was never written is empty", async () => {
    const { readThreads } = await lib();
    expect(readThreads()).toEqual([]);
  });

  // A path that exists but is not a readable file loses the threads, not the run.
  test("a store that cannot be read at all is empty, not a throw", async () => {
    const { readThreads } = await lib();
    expect(readThreads(HOME)).toEqual([]);
  });

  test("round-trips through the file", async () => {
    const { readThreads, writeThreads } = await lib();
    const store = await threads("first", "second");
    writeThreads(store);
    expect(readThreads()).toEqual(store);
  });

  test("a write replaces the store rather than appending to it", async () => {
    const { readThreads, writeThreads } = await lib();
    writeThreads(await threads("first", "second"));
    writeThreads(await threads("only"));
    expect(readThreads().map((t) => t.title)).toEqual(["only"]);
  });
});

describe("resolveThreadIn", () => {
  test("marks the thread resolved and stamps when", async () => {
    const { resolveThreadIn } = await lib();
    const store = await threads("first", "second");
    const resolution = resolveThreadIn(store, "id-1", LATER);
    expect(resolution?.thread.status).toBe("resolved");
    expect(resolution?.thread.resolved).toBe("2026-09-07T09:30:00.000Z");
  });

  test("leaves every other thread alone", async () => {
    const { resolveThreadIn } = await lib();
    const store = await threads("first", "second", "third");
    const resolution = resolveThreadIn(store, "id-1", LATER);
    expect(resolution?.threads[0]).toEqual(store[0]);
    expect(resolution?.threads[2]).toEqual(store[2]);
    expect(resolution?.threads[1].title).toBe("second");
  });

  // An unknown id is a failure the CLI reports, not a silent no-op write.
  test("an unknown id resolves nothing", async () => {
    const { resolveThreadIn } = await lib();
    expect(resolveThreadIn(await threads("first"), "nope", LATER)).toBeNull();
  });

  test("does not edit the store it was given", async () => {
    const { resolveThreadIn } = await lib();
    const store = await threads("first");
    resolveThreadIn(store, "id-0", LATER);
    expect(store[0].status).toBe("open");
    expect(store[0].resolved).toBeNull();
  });
});

describe("visibleThreads", () => {
  async function mixed() {
    const { resolveThreadIn } = await lib();
    const store = await threads("open one", "closed one", "open two");
    return resolveThreadIn(store, "id-1", LATER)?.threads ?? store;
  }

  test("shows only the open threads by default", async () => {
    const { visibleThreads } = await lib();
    expect(visibleThreads(await mixed(), false).map((t) => t.title)).toEqual([
      "open one",
      "open two",
    ]);
  });

  test("--all shows the resolved ones too", async () => {
    const { visibleThreads } = await lib();
    expect(visibleThreads(await mixed(), true)).toHaveLength(3);
  });
});
