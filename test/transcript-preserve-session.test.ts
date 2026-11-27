import { beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  preserveTranscripts,
  stageSessionTranscript,
  stagingDir,
} from "../src/bronze/transcript-preserve";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

let root: string;
let at: { source: string; target: string; manifest: string };

function writeTranscript(
  rel: string,
  body: string,
  mtimeSeconds = 1_700_000_000
): string {
  const file = resolve(at.source, rel);
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, body);
  utimesSync(file, mtimeSeconds, mtimeSeconds);

  return file;
}

const copiedExists = (rel: string) => existsSync(resolve(at.target, `${rel}.gz`));

const copied = (rel: string) =>
  new TextDecoder().decode(Bun.gunzipSync(readFileSync(resolve(at.target, `${rel}.gz`))));

const staged = () =>
  existsSync(stagingDir(at))
    ? (readdirSync(stagingDir(at), { recursive: true }) as string[])
        .map((name) => name.replaceAll("\\", "/"))
        .filter((name) => statSync(resolve(stagingDir(at), name)).isFile())
        .sort()
    : [];

const manifest = () => JSON.parse(readFileSync(at.manifest, "utf-8"));

beforeEach(() => {
  root = freshTestDir(import.meta.file);
  at = {
    source: resolve(root, "projects"),
    target: resolve(root, "content", "claude"),
    manifest: resolve(root, "state", "transcript-copies.json"),
  };
});

describe("stageSessionTranscript", () => {
  test("stages the closing session and its subagents uncompressed, and no other session", () => {
    const own = writeTranscript("-sales/job.jsonl", '{"a":1}\n');
    writeTranscript("-sales/job/subagents/agent-x.jsonl", '{"b":2}\n');
    writeTranscript("-sales/other.jsonl", '{"c":3}\n');
    expect(stageSessionTranscript(own, at)).toEqual({
      copied: 2,
      unchanged: 0,
      failed: 0,
    });
    expect(staged()).toEqual([
      "-sales/job.jsonl~8-1700000000000",
      "-sales/job/subagents/agent-x.jsonl~8-1700000000000",
    ]);
    expect(
      readFileSync(resolve(stagingDir(at), "-sales/job.jsonl~8-1700000000000"), "utf-8")
    ).toBe('{"a":1}\n');
    expect(copiedExists("-sales/job.jsonl")).toBe(false);
  });

  test("skips a transcript the archive already holds at this version", async () => {
    const own = writeTranscript("-sales/job.jsonl", '{"a":1}\n');
    await preserveTranscripts(at);
    expect(stageSessionTranscript(own, at)).toEqual({
      copied: 0,
      unchanged: 1,
      failed: 0,
    });
    expect(staged()).toEqual([]);
  });

  test("counts a file it cannot stage as failed and stages the rest", () => {
    const own = writeTranscript("-sales/job.jsonl", '{"a":1}\n');
    writeTranscript("-sales/job/subagents/agent-x.jsonl", '{"b":2}\n');
    mkdirSync(resolve(stagingDir(at), "-sales/job.jsonl~8-1700000000000"), {
      recursive: true,
    });
    writeFileSync(resolve(stagingDir(at), "-sales/job.jsonl~8-1700000000000/x"), "");
    expect(stageSessionTranscript(own, at)).toEqual({
      copied: 1,
      unchanged: 0,
      failed: 1,
    });
    expect(staged().filter((name) => name.endsWith(".partial"))).toEqual([]);
  });

  test("a path outside Claude Code's projects folder, or none, stages nothing", () => {
    const outside = resolve(root, "elsewhere", "s.jsonl");
    mkdirSync(resolve(outside, ".."), { recursive: true });
    writeFileSync(outside, "{}\n");
    expect(stageSessionTranscript(outside, at)).toBeNull();
    expect(stageSessionTranscript(undefined, at)).toBeNull();
    expect(stageSessionTranscript(resolve(at.source, "../x.jsonl"), at)).toBeNull();
    expect(stageSessionTranscript(resolve(at.source, "-p/notes.txt"), at)).toBeNull();
  });
});

describe("the sweep finishes staged copies", () => {
  test("gzips a staged copy into the archive, records it and clears the stage", async () => {
    const own = writeTranscript("-sales/job.jsonl", '{"a":1}\n');
    stageSessionTranscript(own, at);
    expect(await preserveTranscripts(at)).toEqual({ copied: 1, unchanged: 1, failed: 0 });
    expect(copied("-sales/job.jsonl")).toBe('{"a":1}\n');
    expect(manifest()).toEqual({ "-sales/job.jsonl": "8:1700000000000" });
    expect(staged()).toEqual([]);
    expect(await preserveTranscripts(at)).toEqual({ copied: 0, unchanged: 1, failed: 0 });
  });

  test("archives the staged copy itself while the original is unchanged", async () => {
    const own = writeTranscript("-sales/job.jsonl", "staged\n");
    stageSessionTranscript(own, at);
    writeTranscript("-sales/job.jsonl", "source\n");
    await preserveTranscripts(at);
    expect(copied("-sales/job.jsonl")).toBe("staged\n");
  });

  test("keeps the session after Claude Code deleted the original", async () => {
    const own = writeTranscript("-sales/job.jsonl", '{"a":1}\n');
    stageSessionTranscript(own, at);
    removeOnceReleased(at.source);
    expect(await preserveTranscripts(at)).toEqual({ copied: 1, unchanged: 0, failed: 0 });
    expect(copied("-sales/job.jsonl")).toBe('{"a":1}\n');
  });

  test("drops a staged copy whose original changed since, and archives the original", async () => {
    const own = writeTranscript("-sales/job.jsonl", '{"a":1}\n');
    stageSessionTranscript(own, at);
    writeTranscript("-sales/job.jsonl", '{"a":1}\n{"a":2}\n', 1_700_000_100);
    expect(await preserveTranscripts(at)).toEqual({ copied: 1, unchanged: 1, failed: 0 });
    expect(copied("-sales/job.jsonl")).toBe('{"a":1}\n{"a":2}\n');
    expect(staged()).toEqual([]);
  });

  test("drops a staged copy the archive already holds, without rewriting it", async () => {
    const own = writeTranscript("-sales/job.jsonl", '{"a":1}\n');
    stageSessionTranscript(own, at);
    const aside = resolve(root, "aside");
    renameSync(stagingDir(at), aside);
    await preserveTranscripts(at);
    writeFileSync(resolve(at.target, "-sales/job.jsonl.gz"), Bun.gzipSync("archived"));
    renameSync(aside, stagingDir(at));
    expect(await preserveTranscripts(at)).toEqual({ copied: 0, unchanged: 2, failed: 0 });
    expect(copied("-sales/job.jsonl")).toBe("archived");
    expect(staged()).toEqual([]);
  });

  test("never lets an older staged copy overwrite a newer archived one", async () => {
    writeTranscript("-sales/job.jsonl", "new\n", 1_700_000_100);
    await preserveTranscripts(at);
    removeOnceReleased(at.source);
    mkdirSync(resolve(stagingDir(at), "-sales"), { recursive: true });
    writeFileSync(resolve(stagingDir(at), "-sales/job.jsonl~4-1700000000000"), "old\n");
    expect(await preserveTranscripts(at)).toEqual({ copied: 0, unchanged: 1, failed: 0 });
    expect(copied("-sales/job.jsonl")).toBe("new\n");
  });

  test("keeps a staged copy it could not archive, for the next sweep", async () => {
    const own = writeTranscript("-sales/job.jsonl", '{"a":1}\n');
    stageSessionTranscript(own, at);
    removeOnceReleased(at.source);
    mkdirSync(resolve(at.target, "-sales/job.jsonl.gz", "blocker"), { recursive: true });
    expect(await preserveTranscripts(at)).toEqual({ copied: 0, unchanged: 0, failed: 1 });
    expect(staged()).toEqual(["-sales/job.jsonl~8-1700000000000"]);
  });

  test("removes a partial stage abandoned half an hour ago, and leaves a fresh one", async () => {
    mkdirSync(resolve(stagingDir(at), "-p"), { recursive: true });
    const old = resolve(stagingDir(at), "-p/a.jsonl~1-1.partial");
    const fresh = resolve(stagingDir(at), "-p/b.jsonl~1-1.partial");
    const oldComplete = resolve(stagingDir(at), "-p/c.jsonl~1-1");
    writeFileSync(old, "x");
    writeFileSync(fresh, "x");
    writeFileSync(oldComplete, "c");
    const longAgo = (Date.now() - 31 * 60_000) / 1000;
    utimesSync(old, longAgo, longAgo);
    utimesSync(oldComplete, longAgo, longAgo);
    expect(await preserveTranscripts(at)).toEqual({ copied: 1, unchanged: 0, failed: 0 });
    expect(staged()).toEqual(["-p/b.jsonl~1-1.partial"]);
    expect(copied("-p/c.jsonl")).toBe("c");
  });
});
