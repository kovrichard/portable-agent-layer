import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import type { Bindings } from "../src/hooks/lib/bindings";
import { PRICE_HISTORY } from "../src/hooks/lib/models";
import type { ProjectProgress } from "../src/hooks/lib/projects";
import {
  addToBucket,
  addToTimeBuckets,
  emptyBucket,
  emptyTimeBuckets,
  grandTotal,
  horizonsFrom,
  readClaudeCode,
  readPalInference,
  totalTokens,
} from "../src/tools/lib/usage-buckets";
import { freshTestDir, outsideRepoHome } from "./lib/test-home";
import { event } from "./lib/wrapped-events";

const NOW = new Date("2026-09-06T12:00:00.000Z");

beforeEach(() => {
  delete PRICE_HISTORY["claude-opus-5"];
});
const HORIZONS = horizonsFrom(NOW);

function tempHome(): string {
  return freshTestDir(import.meta.file);
}

const palCall = (ts: string, fields: Record<string, unknown> = {}) =>
  event(
    "inference_call",
    {
      caller: "c",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 100,
      outputTokens: 10,
      ...fields,
    },
    { ts }
  );

const tokens = (input: number, output: number, cw5m = 0, cw1h = 0, cr = 0) => ({
  input,
  output,
  cacheWrite5m: cw5m,
  cacheWrite1h: cw1h,
  cacheRead: cr,
});

function assistantLine(
  ts: string,
  model: string,
  usage: Record<string, unknown>,
  cwd?: string
): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    ...(cwd === undefined ? {} : { cwd }),
    message: { model, usage },
  });
}

type Resolver = (cwd: string | undefined) => string;
type ResolverFactory = (
  projects: ProjectProgress[],
  bindings: Bindings,
  paths?: typeof posix | typeof win32
) => Resolver;

async function projectResolver(): Promise<ResolverFactory> {
  const mod = (await import("../src/tools/lib/project-resolver")) as {
    projectResolver: ResolverFactory;
  };

  return mod.projectResolver;
}

const registered = (name: string) => ({ name }) as ProjectProgress;

function repo(parent: string, ...parts: string[]): string {
  const dir = join(parent, ...parts);
  mkdirSync(join(dir, ".git"), { recursive: true });

  return dir;
}

function transcriptIn(dir: string, folder: string, lines: string[]): void {
  mkdirSync(join(dir, folder), { recursive: true });
  writeFileSync(join(dir, folder, "s.jsonl"), lines.join("\n"));
}

const TS = "2026-09-06T08:00:00.000Z";
const call = (input: number, cwd?: string) =>
  assistantLine(TS, "claude-opus-5", { input_tokens: input }, cwd);

describe("emptyBucket / emptyTimeBuckets", () => {
  test("starts every counter at zero", () => {
    expect(emptyBucket()).toEqual({
      input: 0,
      output: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
      cost: 0,
      calls: 0,
      unpriced: 0,
    });
  });

  test("gives each window its own bucket, so one does not alias another", () => {
    const buckets = emptyTimeBuckets();
    buckets.today.calls = 5;
    expect(buckets.week.calls).toBe(0);
    expect(buckets.total.calls).toBe(0);
  });
});

describe("horizonsFrom", () => {
  test("takes today's prefix off the date, not the time", () => {
    expect(horizonsFrom(NOW).todayPrefix).toBe("2026-09-06");
  });

  test("puts the week cutoff seven days back", () => {
    expect(horizonsFrom(NOW).weekAgo).toBe("2026-08-30T12:00:00.000Z");
  });

  test("puts the month cutoff thirty days back", () => {
    expect(horizonsFrom(NOW).monthAgo).toBe("2026-08-07T12:00:00.000Z");
  });

  test("the week cutoff is later than the month cutoff", () => {
    const { weekAgo, monthAgo } = horizonsFrom(NOW);
    expect(weekAgo > monthAgo).toBe(true);
  });
});

describe("addToBucket", () => {
  test("accumulates every token field and counts the call", () => {
    const bucket = emptyBucket();
    addToBucket(bucket, "claude-opus-5", tokens(10, 20, 30, 40, 50), NOW.toISOString());
    addToBucket(bucket, "claude-opus-5", tokens(1, 2, 3, 4, 5), NOW.toISOString());
    expect(bucket.input).toBe(11);
    expect(bucket.output).toBe(22);
    expect(bucket.cacheWrite5m).toBe(33);
    expect(bucket.cacheWrite1h).toBe(44);
    expect(bucket.cacheRead).toBe(55);
    expect(bucket.calls).toBe(2);
  });

  test("prices what it accumulates", () => {
    const bucket = emptyBucket();
    addToBucket(bucket, "claude-opus-5", tokens(1_000_000, 1_000_000), NOW.toISOString());
    expect(bucket.cost).toBeGreaterThan(0);
  });

  test("prices per model, so a cheap model costs less than an expensive one", () => {
    const opus = emptyBucket();
    const haiku = emptyBucket();
    const ts = NOW.toISOString();
    addToBucket(opus, "claude-opus-5", tokens(1_000_000, 1_000_000), ts);
    addToBucket(haiku, "claude-haiku-4-5-20251001", tokens(1_000_000, 1_000_000), ts);
    expect(haiku.cost).toBeLessThan(opus.cost);
  });
});

describe("addToTimeBuckets", () => {
  test("counts a call from today in all four windows", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, "2026-09-06T09:00:00.000Z", "m", tokens(1, 1), HORIZONS);
    expect(buckets.today.calls).toBe(1);
    expect(buckets.week.calls).toBe(1);
    expect(buckets.month.calls).toBe(1);
    expect(buckets.total.calls).toBe(1);
  });

  test("a call from three days ago misses today but makes the week", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, "2026-09-03T09:00:00.000Z", "m", tokens(1, 1), HORIZONS);
    expect(buckets.today.calls).toBe(0);
    expect(buckets.week.calls).toBe(1);
    expect(buckets.month.calls).toBe(1);
  });

  test("a call from two weeks ago makes only the month and the total", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, "2026-08-23T09:00:00.000Z", "m", tokens(1, 1), HORIZONS);
    expect(buckets.week.calls).toBe(0);
    expect(buckets.month.calls).toBe(1);
    expect(buckets.total.calls).toBe(1);
  });

  test("a call older than a month still counts toward the total", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, "2026-01-01T09:00:00.000Z", "m", tokens(1, 1), HORIZONS);
    expect(buckets.month.calls).toBe(0);
    expect(buckets.total.calls).toBe(1);
  });

  test("the week cutoff is inclusive — a call exactly on it is inside", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, HORIZONS.weekAgo, "m", tokens(1, 1), HORIZONS);
    expect(buckets.week.calls).toBe(1);
  });

  test("the month cutoff is inclusive too", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, HORIZONS.monthAgo, "m", tokens(1, 1), HORIZONS);
    expect(buckets.month.calls).toBe(1);
  });

  test("one tick before the week cutoff falls out of the week", () => {
    const buckets = emptyTimeBuckets();
    addToTimeBuckets(buckets, "2026-08-30T11:59:59.999Z", "m", tokens(1, 1), HORIZONS);
    expect(buckets.week.calls).toBe(0);
    expect(buckets.month.calls).toBe(1);
  });
});

describe("totalTokens", () => {
  test("sums all five token fields", () => {
    const bucket = emptyBucket();
    addToBucket(bucket, "m", tokens(1, 2, 4, 8, 16), NOW.toISOString());
    expect(totalTokens(bucket)).toBe(31);
  });
});

describe("project resolver", () => {
  test("a cwd at or inside a registered project resolves to its name, existing or not", async () => {
    const make = await projectResolver();
    const docs = join(tempHome(), "docs");
    mkdirSync(docs, { recursive: true });
    const resolveName = make([registered("bidding-ecosystem")], {
      "bidding-ecosystem": docs,
    });
    expect(resolveName(docs)).toBe("bidding-ecosystem");
    expect(resolveName(join(docs, "sub", "dir"))).toBe("bidding-ecosystem");
    expect(resolveName(join(docs, ".claude", "worktrees", "agent-1"))).toBe(
      "bidding-ecosystem"
    );
  });

  test("a registered project wins over the repo folder's own name", async () => {
    const make = await projectResolver();
    const dir = repo(tempHome(), "folder-name");
    expect(make([registered("chosen")], { chosen: dir })(dir)).toBe("chosen");
  });

  test("an unregistered repo resolves to its folder name from the root and any subfolder", async () => {
    const make = await projectResolver();
    const widgets = repo(tempHome(), "widgets");
    mkdirSync(join(widgets, "crates", "core"), { recursive: true });
    const resolveName = make([], {});
    expect(resolveName(widgets)).toBe("widgets");
    expect(resolveName(join(widgets, "crates", "core"))).toBe("widgets");
  });

  test("a linked worktree resolves to its main repo, or to the project registered there", async () => {
    const make = await projectResolver();
    const tmp = tempHome();
    const widgets = repo(tmp, "widgets");
    const wt = join(tmp, "wt-1");
    mkdirSync(wt, { recursive: true });
    writeFileSync(
      join(wt, ".git"),
      `gitdir: ${join(widgets, ".git", "worktrees", "wt-1")}\n`
    );
    expect(make([], {})(wt)).toBe("widgets");
    expect(make([registered("Widget Co")], { "Widget Co": widgets })(wt)).toBe(
      "Widget Co"
    );
  });

  test("a .git file that is not a worktree pointer makes its folder the repo", async () => {
    const make = await projectResolver();
    const sub = join(tempHome(), "submod");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, ".git"), "gitdir: ../.git/modules/submod\n");
    expect(make([], {})(sub)).toBe("submod");
  });

  test("anything unresolvable is exactly (unknown), every time it is asked", async () => {
    const make = await projectResolver();
    const tmp = outsideRepoHome(import.meta.file);
    const plain = join(tmp, "plain-folder");
    mkdirSync(plain, { recursive: true });
    const resolveName = make([], {});
    expect(resolveName(undefined)).toBe("(unknown)");
    expect(resolveName(join(tmp, "gone", "worktrees", "task-1"))).toBe("(unknown)");
    expect(resolveName(plain)).toBe("(unknown)");
    expect(resolveName(plain)).toBe("(unknown)");
  });

  test("on Windows a cwd matches a registered path whatever its separators, drive-letter case and letter case", async () => {
    const make = await projectResolver();
    const resolveName = make(
      [registered("repo")],
      { repo: "C:\\Users\\x\\git\\repo" },
      win32
    );
    expect(resolveName("C:\\Users\\x\\git\\repo")).toBe("repo");
    expect(resolveName("c:/users/x/git/repo")).toBe("repo");
    expect(resolveName("C:\\USERS\\X\\GIT\\REPO\\src\\lib")).toBe("repo");
    expect(resolveName("C:\\Users\\x\\git\\repo-other")).toBe("(unknown)");
  });

  test("on other systems the registered path match stays case-sensitive", async () => {
    const make = await projectResolver();
    const resolveName = make([registered("repo")], { repo: "/home/x/git/repo" }, posix);
    expect(resolveName("/home/x/git/repo/src")).toBe("repo");
    expect(resolveName("/home/x/git/Repo")).toBe("(unknown)");
  });

  test("a repo literally named unknown keeps its name", async () => {
    const make = await projectResolver();
    const dir = repo(tempHome(), "unknown");
    expect(make([], {})(dir)).toBe("unknown");
  });
});

describe("readClaudeCode", () => {
  test("returns empty buckets when the projects directory does not exist", () => {
    const result = readClaudeCode(join(tempHome(), "nope"), undefined, NOW);
    expect(result.buckets.total.calls).toBe(0);
    expect(result.byModel).toEqual({});
    expect(result.byProject).toEqual({});
  });

  test("reads a transcript into the windows, by model and by project", () => {
    const dir = tempHome();
    const proj = join(dir, "-home-user-git-pal");
    const pal = repo(dir, "work", "pal");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s1.jsonl"),
      [
        assistantLine(
          "2026-09-06T08:00:00.000Z",
          "claude-opus-5",
          { input_tokens: 100, output_tokens: 200 },
          pal
        ),
        assistantLine(
          "2026-08-20T08:00:00.000Z",
          "claude-opus-5",
          { input_tokens: 5, output_tokens: 5 },
          pal
        ),
      ].join("\n")
    );

    const result = readClaudeCode(dir, undefined, NOW);
    expect(result.buckets.total.calls).toBe(2);
    expect(result.buckets.today.calls).toBe(1);
    expect(result.buckets.today.input).toBe(100);
    expect(result.buckets.today.output).toBe(200);
    expect(result.buckets.total.output).toBe(205);
    expect(result.byModel["claude-opus-5"].calls).toBe(2);
    expect(result.byProject.pal.total.calls).toBe(2);
  });

  describe("with PAL's archive of the transcripts", () => {
    let palCwd = "";
    let goneCwd = "";
    beforeEach(() => {
      const base = tempHome();
      palCwd = repo(base, "pal");
      goneCwd = repo(base, "gone");
    });
    const turn = (input: number) =>
      assistantLine(
        NOW.toISOString(),
        "claude-opus-5",
        { input_tokens: input, output_tokens: 0 },
        input >= 1000 ? goneCwd : palCwd
      );

    function transcript(path: string, input: number): void {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, turn(input));
    }

    function archived(path: string, input: number): void {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(`${path}.gz`, Bun.gzipSync(turn(input)));
    }

    function homes() {
      const dir = tempHome();

      return { live: join(dir, "projects"), archive: join(dir, "archive") };
    }

    test("a transcript Claude Code deleted is still read from PAL's archive", () => {
      const { live, archive } = homes();
      transcript(join(live, "-w-pal", "kept.jsonl"), 1);
      archived(join(archive, "-w-pal", "kept.jsonl"), 1);
      archived(join(archive, "-w-pal", "deleted.jsonl"), 10);
      archived(join(archive, "-w-pal", "deleted", "subagents", "agent-a.jsonl"), 100);
      archived(join(archive, "-w-gone", "only.jsonl"), 1000);
      archived(join(archive, "-w-gone", "notes.json"), 10_000);

      const usage = readClaudeCode(live, undefined, NOW, archive);
      expect(usage.buckets.total.input).toBe(1111);
      expect(usage.byProject.pal.total.input).toBe(111);
      expect(usage.byProject.gone.total.input).toBe(1000);
    });

    test("without an archive only the live transcripts count", () => {
      const { live, archive } = homes();
      transcript(join(live, "-w-pal", "kept.jsonl"), 1);
      archived(join(archive, "-w-pal", "deleted.jsonl"), 10);
      expect(readClaudeCode(live, undefined, NOW).buckets.total.input).toBe(1);
      expect(
        readClaudeCode(live, undefined, NOW, join(archive, "absent")).buckets.total.input
      ).toBe(1);
    });

    test("an archived copy that is not gzip is skipped", () => {
      const { live, archive } = homes();
      mkdirSync(join(archive, "-w-pal"), { recursive: true });
      writeFileSync(join(archive, "-w-pal", "broken.jsonl.gz"), "not gzip");
      expect(readClaudeCode(live, undefined, NOW, archive).buckets.total.calls).toBe(0);
    });
  });

  test("a message written as one line per content block is billed once, at its final usage", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-real");
    mkdirSync(proj, { recursive: true });
    const block = (id: string, type: string, output = 300) =>
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-09-06T08:00:00.000Z",
        message: {
          id,
          model: "claude-opus-5",
          content: [{ type }],
          usage: { input_tokens: 10, output_tokens: output },
        },
      });
    writeFileSync(
      join(proj, "s.jsonl"),
      [
        block("msg_1", "thinking", 3),
        block("msg_2", "text"),
        block("msg_1", "tool_use"),
      ].join("\n")
    );
    const total = readClaudeCode(dir, undefined, NOW).buckets.total;
    expect([total.calls, total.input, total.output]).toEqual([2, 20, 600]);
  });

  test("ignores a stray file sitting beside the project directories", () => {
    const dir = tempHome();
    writeFileSync(join(dir, "stray.jsonl"), "not a project");
    const proj = join(dir, "-p-real");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 3 })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(3);
  });

  test("bills a subagent transcript to the project that spawned it", () => {
    const dir = tempHome();
    const subagents = join(dir, "-home-user-git-pal", "session-a", "subagents");
    mkdirSync(subagents, { recursive: true });
    writeFileSync(
      join(subagents, "sub.jsonl"),
      assistantLine(
        "2026-09-06T08:00:00.000Z",
        "claude-opus-5",
        { input_tokens: 7, output_tokens: 3 },
        repo(dir, "work", "pal")
      )
    );

    const result = readClaudeCode(dir, undefined, NOW);
    expect(result.buckets.total.calls).toBe(1);
    expect(result.byProject.pal.total.input).toBe(7);
  });

  test("reads only the transcripts in a subagents directory", () => {
    const dir = tempHome();
    const subagents = join(dir, "-p-mixed", "session-a", "subagents");
    mkdirSync(subagents, { recursive: true });
    writeFileSync(
      join(subagents, "notes.md"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 500 })
    );
    writeFileSync(
      join(subagents, "sub.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 9 })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(9);
  });

  test("a directory that happens to be named like a transcript is skipped", () => {
    const dir = tempHome();
    const subagents = join(dir, "-p-dirlike", "session-a", "subagents");
    mkdirSync(join(subagents, "impostor.jsonl"), { recursive: true });
    writeFileSync(
      join(subagents, "real.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 11 })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(11);
  });

  test("an assistant turn with no message at all is skipped, not thrown on", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-headless");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-09-06T08:00:00.000Z",
          note: "usage",
        }),
        assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 8 }),
      ].join("\n")
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(8);
  });

  test("a project directory with no subagents dir is not an error", () => {
    const dir = tempHome();
    const proj = join(dir, "-home-user-git-pal");
    mkdirSync(join(proj, "session-a"), { recursive: true });
    writeFileSync(
      join(proj, "s1.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 4 })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.calls).toBe(1);
  });

  test("the project filter is a substring match on the resolved name", () => {
    const dir = tempHome();
    const layer = repo(dir, "work", "portable-agent-layer");
    const widgets = repo(dir, "work", "widgets");
    transcriptIn(dir, "-a", [call(10, layer)]);
    transcriptIn(dir, "-b", [call(20, widgets)]);

    const byWidgets = readClaudeCode(dir, "idge", NOW);
    expect(Object.keys(byWidgets.byProject)).toEqual(["widgets"]);
    expect(byWidgets.buckets.total.input).toBe(20);

    const byLayer = readClaudeCode(dir, "portable-agent-layer", NOW);
    expect(Object.keys(byLayer.byProject)).toEqual(["portable-agent-layer"]);
    expect(byLayer.buckets.total.input).toBe(10);
  });

  test("the project comes from the line's cwd, whatever the folder is called", () => {
    const dir = tempHome();
    const layer = repo(dir, "git", "portable-agent-layer");
    transcriptIn(dir, "-x-git-portable-agent-layer", [call(1, layer)]);
    expect(Object.keys(readClaudeCode(dir, undefined, NOW).byProject)).toEqual([
      "portable-agent-layer",
    ]);
    const other = tempHome();
    transcriptIn(other, "-anything-else", [call(1, layer)]);
    expect(Object.keys(readClaudeCode(other, undefined, NOW).byProject)).toEqual([
      "portable-agent-layer",
    ]);
  });

  test("a line without a cwd is filed under (unknown)", () => {
    const dir = tempHome();
    transcriptIn(dir, "-x-git-widgets", [call(1)]);
    const result = readClaudeCode(dir, undefined, NOW);
    expect(Object.keys(result.byProject)).toEqual(["(unknown)"]);
    expect(result.buckets.total.calls).toBe(1);
  });

  test("each call resolves from its own line's cwd", () => {
    const dir = tempHome();
    const widgets = repo(dir, "widgets");
    mkdirSync(join(widgets, "sub"), { recursive: true });
    const other = repo(dir, "other");
    transcriptIn(dir, "-w", [
      call(1, widgets),
      call(2, join(widgets, "sub")),
      call(4, other),
    ]);
    const result = readClaudeCode(dir, undefined, NOW);
    expect(result.byProject.widgets.total.input).toBe(3);
    expect(result.byProject.other.total.input).toBe(4);
  });

  test("a registered project's name is used, via the resolver handed in", async () => {
    const make = await projectResolver();
    const dir = tempHome();
    const docs = join(dir, "docs");
    mkdirSync(docs, { recursive: true });
    transcriptIn(dir, "-d", [call(1, join(docs, "sub"))]);
    const resolver = make([registered("bidding-ecosystem")], {
      "bidding-ecosystem": docs,
    });
    const result = readClaudeCode(dir, undefined, NOW, undefined, resolver);
    expect(Object.keys(result.byProject)).toEqual(["bidding-ecosystem"]);
  });

  test("skips lines that are not assistant turns", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-user");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-09-06T08:00:00.000Z",
          message: { model: "claude-opus-5", usage: { input_tokens: 999 } },
        }),
        assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 1 }),
      ].join("\n")
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(1);
  });

  test("skips an assistant turn with no timestamp", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-notime");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-opus-5", usage: { input_tokens: 5 } },
      })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.calls).toBe(0);
  });

  test("skips an assistant turn with no model", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-nomodel");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-09-06T08:00:00.000Z",
        message: { usage: { input_tokens: 5 } },
      })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.calls).toBe(0);
  });

  test("survives a malformed line that still mentions usage", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-broken");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      [
        '{"usage" broken json',
        assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 2 }),
      ].join("\n")
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(2);
  });

  test("reads the cache-write breakdown when the transcript carries one", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-breakdown");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", {
        cache_creation_input_tokens: 999,
        cache_creation: {
          ephemeral_5m_input_tokens: 10,
          ephemeral_1h_input_tokens: 20,
        },
        cache_read_input_tokens: 30,
      })
    );
    const total = readClaudeCode(dir, undefined, NOW).buckets.total;
    expect(total.cacheWrite5m).toBe(10);
    expect(total.cacheWrite1h).toBe(20);
    expect(total.cacheRead).toBe(30);
  });

  test("bills an older transcript's single cache-write total as 5m", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-legacy");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", {
        cache_creation_input_tokens: 500,
      })
    );
    const total = readClaudeCode(dir, undefined, NOW).buckets.total;
    expect(total.cacheWrite5m).toBe(500);
    expect(total.cacheWrite1h).toBe(0);
  });

  test("ignores files in a project directory that are not transcripts", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-noise");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "notes.md"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 400 })
    );
    writeFileSync(
      join(proj, "s.jsonl"),
      assistantLine("2026-09-06T08:00:00.000Z", "claude-opus-5", { input_tokens: 6 })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.input).toBe(6);
  });
});

describe("a price change reaches every reader", () => {
  const OPUS_5_LAUNCH = {
    input: 6,
    output: 30,
    cacheWrite5m: 7.5,
    cacheWrite1h: 12,
    cacheRead: 0.6,
  };
  const BEFORE = "2026-08-20T08:00:00.000Z";

  beforeEach(() => {
    PRICE_HISTORY["claude-opus-5"] = [{ until: "2026-09-01", rates: OPUS_5_LAUNCH }];
  });

  test("a transcript call is priced at the rate on its own date", () => {
    const dir = tempHome();
    const proj = join(dir, "-p-real");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "s.jsonl"),
      assistantLine(BEFORE, "claude-opus-5", { input_tokens: 1_000_000 })
    );
    expect(readClaudeCode(dir, undefined, NOW).buckets.total.cost).toBeCloseTo(6, 10);
  });

  test("a PAL inference call is too, in its windows and under its caller", () => {
    const result = readPalInference(
      [
        palCall(BEFORE, {
          caller: "c",
          model: "claude-opus-5",
          inputTokens: 1_000_000,
          outputTokens: 0,
        }),
      ],
      NOW
    );
    expect(result.buckets.total.cost).toBeCloseTo(6, 10);
    expect(result.byCaller.c.cost).toBeCloseTo(6, 10);
  });
});

describe("readPalInference", () => {
  const HAIKU = "claude-haiku-4-5-20251001";

  test("nothing logged leaves every bucket empty", () => {
    const result = readPalInference([], NOW);
    expect(result.buckets.total.calls).toBe(0);
    expect(result.byCaller).toEqual({});
  });

  test("splits a call across the windows, the model and the caller", () => {
    const result = readPalInference(
      [
        palCall("2026-09-06T08:00:00.000Z", {
          caller: "failure-principle",
          inputTokens: 300,
          outputTokens: 40,
        }),
        palCall("2026-08-25T08:00:00.000Z", { caller: "synthesize" }),
      ],
      NOW
    );
    expect(result.buckets.total.calls).toBe(2);
    expect(result.buckets.today.input).toBe(300);
    expect(result.byModel[HAIKU].month.calls).toBe(2);
    expect(result.byCaller["failure-principle"].input).toBe(300);
    expect(result.byCaller.synthesize.calls).toBe(1);
  });

  test("counts the cache traffic a call reported", () => {
    const total = readPalInference(
      [palCall(NOW.toISOString(), { cacheWrite5m: 5, cacheWrite1h: 7, cacheRead: 11 })],
      NOW
    ).buckets.total;
    expect(total).toMatchObject({ cacheWrite5m: 5, cacheWrite1h: 7, cacheRead: 11 });
  });

  test("a call without input or output counts is left out, not counted as zero", () => {
    const result = readPalInference(
      [
        palCall(NOW.toISOString(), { inputTokens: null }),
        palCall(NOW.toISOString(), { outputTokens: null }),
        palCall(NOW.toISOString(), { inputTokens: undefined }),
        palCall(NOW.toISOString(), { model: null, caller: null }),
        event("model_call", { inputTokens: 1, outputTokens: 1 }),
      ],
      NOW
    );
    expect(result.buckets.total.calls).toBe(1);
    expect(Object.keys(result.byModel)).toEqual(["unknown"]);
    expect(Object.keys(result.byCaller)).toEqual(["anonymous"]);
  });
});

describe("grandTotal", () => {
  test("sums every field across the buckets it is given", () => {
    const a = emptyBucket();
    const b = emptyBucket();
    addToBucket(a, "claude-opus-5", tokens(1, 2, 3, 4, 5), NOW.toISOString());
    addToBucket(b, "claude-opus-5", tokens(10, 20, 30, 40, 50), NOW.toISOString());

    const grand = grandTotal([a, b]);
    expect(grand.input).toBe(11);
    expect(grand.output).toBe(22);
    expect(grand.cacheWrite5m).toBe(33);
    expect(grand.cacheWrite1h).toBe(44);
    expect(grand.cacheRead).toBe(55);
    expect(grand.calls).toBe(2);
    expect(grand.cost).toBeCloseTo(a.cost + b.cost, 12);
  });

  test("an empty list totals to zero", () => {
    expect(grandTotal([])).toEqual(emptyBucket());
  });

  test("does not mutate the buckets it sums", () => {
    const a = emptyBucket();
    addToBucket(a, "claude-opus-5", tokens(1, 1), NOW.toISOString());
    grandTotal([a, a]);
    expect(a.calls).toBe(1);
  });
});

describe("readPalInference: System One judge_call events", () => {
  const JEV = "jev-1.14.0";
  const HAIKU = "claude-haiku-4-5-20251001";
  const judgeCall = (fields: Record<string, unknown> = {}, ts = NOW.toISOString()) =>
    event(
      "judge_call",
      {
        caller: "judge-caller",
        mode: "shadow",
        route: "fallback",
        model: JEV,
        inputTokens: 1000,
        costUsd: 0.000042,
        failure: null,
        ...fields,
      },
      { ts }
    );

  test("a reply from System One is one call with its input tokens only", () => {
    const result = readPalInference([judgeCall()], NOW);
    expect(result.byModel[JEV].total).toMatchObject({
      calls: 1,
      input: 1000,
      output: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
    });
  });

  test("the cost is the event's costUsd, not a looked-up price", () => {
    const result = readPalInference([judgeCall({ costUsd: 0.5 })], NOW);
    expect(result.byModel[JEV].total.cost).toBe(0.5);
    expect(result.byModel[JEV].total.unpriced).toBe(0);
  });

  test("shadow and live calls are counted, whichever route answered", () => {
    const result = readPalInference(
      [
        judgeCall({ mode: "shadow", route: "fallback" }),
        judgeCall({ mode: "live", route: "system-one" }),
        judgeCall({ mode: "live", route: "fallback", failure: "bad-answer" }),
      ],
      NOW
    );
    expect(result.byModel[JEV].total.calls).toBe(3);
  });

  test("a call that got no reply adds nothing", () => {
    const result = readPalInference(
      [
        judgeCall({ mode: "off", model: null, inputTokens: null, costUsd: null }),
        judgeCall({ failure: "no-key", inputTokens: null, costUsd: null }),
        judgeCall({ failure: "timeout", inputTokens: null, costUsd: null }),
      ],
      NOW
    );
    expect(result.buckets.total.calls).toBe(0);
    expect(result.byModel).toEqual({});
    expect(result.byCaller).toEqual({});
  });

  test("a judgment with a judge_call and a fallback inference_call counts each once", () => {
    const result = readPalInference(
      [judgeCall({ costUsd: 0.25 }), palCall(NOW.toISOString())],
      NOW
    );
    const fallbackCost = readPalInference([palCall(NOW.toISOString())], NOW).buckets.total
      .cost;
    expect(Object.keys(result.byModel).sort()).toEqual([HAIKU, JEV].sort());
    expect(result.byModel[JEV].total.calls).toBe(1);
    expect(result.byModel[HAIKU].total.calls).toBe(1);
    expect(result.buckets.total.calls).toBe(2);
    expect(result.buckets.total.cost).toBeCloseTo(0.25 + fallbackCost, 10);
  });

  test("lands in the time windows, the overall buckets and byCaller", () => {
    const result = readPalInference(
      [judgeCall(), judgeCall({}, "2026-07-27T12:00:00.000Z")],
      NOW
    );
    expect(result.byModel[JEV].today.calls).toBe(1);
    expect(result.byModel[JEV].month.calls).toBe(1);
    expect(result.byModel[JEV].total.calls).toBe(2);
    expect(result.buckets.today.calls).toBe(1);
    expect(result.buckets.total.calls).toBe(2);
    expect(result.byCaller["judge-caller"].calls).toBe(2);
  });

  test("zero input tokens with a model is still one call at the event's cost", () => {
    const result = readPalInference([judgeCall({ inputTokens: 0, costUsd: 0.01 })], NOW);
    expect(result.byModel[JEV].total).toMatchObject({ calls: 1, input: 0, cost: 0.01 });
  });

  test("a non-numeric costUsd is priced like an inference call", () => {
    const result = readPalInference([judgeCall({ model: HAIKU, costUsd: null })], NOW);
    const priced = readPalInference(
      [palCall(NOW.toISOString(), { inputTokens: 1000, outputTokens: 0 })],
      NOW
    );
    expect(result.byModel[HAIKU].total.calls).toBe(1);
    expect(result.byModel[HAIKU].total.cost).toBeGreaterThan(0);
    expect(result.byModel[HAIKU].total.cost).toBeCloseTo(
      priced.byModel[HAIKU].total.cost,
      10
    );
  });

  test("numeric inputTokens without a string model adds nothing", () => {
    const result = readPalInference([judgeCall({ model: null })], NOW);
    expect(result.buckets.total.calls).toBe(0);
    expect(result.byModel).toEqual({});
  });

  test("a model shared with inference_call events lands in one block", () => {
    const result = readPalInference(
      [judgeCall({ model: HAIKU, costUsd: 0.5 }), palCall(NOW.toISOString())],
      NOW
    );
    expect(Object.keys(result.byModel)).toEqual([HAIKU]);
    expect(result.byModel[HAIKU].total.calls).toBe(2);
  });

  test("a judge_call and an inference_call with the same caller both count", () => {
    const result = readPalInference(
      [judgeCall({ caller: "same" }), palCall(NOW.toISOString(), { caller: "same" })],
      NOW
    );
    expect(result.byCaller.same.calls).toBe(2);
  });
});
