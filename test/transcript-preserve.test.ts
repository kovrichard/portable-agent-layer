import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  preserveTranscripts,
  preserveTranscriptsOnce,
} from "../src/hooks/lib/transcript-preserve";
import { removeOnceReleased } from "./lib/remove-once-released";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

let root: string;
let at: { source: string; target: string; manifest: string };

function writeTranscript(rel: string, body: string): string {
  const file = resolve(at.source, rel);
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, body);
  return file;
}

function copied(rel: string): string {
  return new TextDecoder().decode(
    Bun.gunzipSync(readFileSync(resolve(at.target, `${rel}.gz`)))
  );
}

beforeEach(() => {
  root = freshTestDir(import.meta.file);
  at = {
    source: resolve(root, "projects"),
    target: resolve(root, "content", "claude"),
    manifest: resolve(root, "state", "transcript-copies.json"),
  };
});

describe("preserveTranscripts", () => {
  test("gzips every transcript, subagents and sidecar files included", () => {
    writeTranscript("-proj/s1.jsonl", '{"a":1}\n');
    writeTranscript("-proj/s1/subagents/agent-x.jsonl", '{"b":2}\n');
    writeTranscript("-proj/s1/tool-results/out.txt", "output");
    expect(preserveTranscripts(at)).toEqual({ copied: 3, unchanged: 0, failed: 0 });
    expect(copied("-proj/s1.jsonl")).toBe('{"a":1}\n');
    expect(copied("-proj/s1/subagents/agent-x.jsonl")).toBe('{"b":2}\n');
    expect(copied("-proj/s1/tool-results/out.txt")).toBe("output");
  });

  test("a second run copies nothing that has not changed", () => {
    writeTranscript("-proj/s1.jsonl", '{"a":1}\n');
    preserveTranscripts(at);
    expect(preserveTranscripts(at)).toEqual({ copied: 0, unchanged: 1, failed: 0 });
  });

  test("a transcript that grew is copied again, whole", () => {
    const file = writeTranscript("-proj/s1.jsonl", '{"a":1}\n');
    preserveTranscripts(at);
    writeFileSync(file, '{"a":1}\n{"a":2}\n');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(preserveTranscripts(at).copied).toBe(1);
    expect(copied("-proj/s1.jsonl")).toBe('{"a":1}\n{"a":2}\n');
  });

  test("the copy outlives the original", () => {
    const file = writeTranscript("-proj/s1.jsonl", '{"a":1}\n');
    preserveTranscripts(at);
    removeOnceReleased(file);
    expect(existsSync(file)).toBe(false);
    expect(copied("-proj/s1.jsonl")).toBe('{"a":1}\n');
  });

  test("no source folder copies nothing and does not throw", () => {
    expect(preserveTranscripts(at)).toEqual({ copied: 0, unchanged: 0, failed: 0 });
  });
});

describe("PreserveTranscripts entrypoint", () => {
  test("copies the configured Claude dir into the PAL home's content store", () => {
    const claudeDir = resolve(root, "claude");
    const home = resolve(root, "home");
    mkdirSync(resolve(claudeDir, "projects", "-proj"), { recursive: true });
    writeFileSync(resolve(claudeDir, "projects", "-proj", "s1.jsonl"), "{}\n");
    const run = Bun.spawnSync(
      ["bun", resolve(import.meta.dir, "../src/hooks/PreserveTranscripts.ts")],
      { env: { ...process.env, PAL_HOME: home, PAL_CLAUDE_DIR: claudeDir } }
    );
    expect(run.exitCode).toBe(0);
    expect(
      existsSync(resolve(home, "memory", "content", "claude", "-proj", "s1.jsonl.gz"))
    ).toBe(true);
  });
});

describe("preserveTranscriptsOnce", () => {
  const lockIn = (home: string) =>
    resolve(home, "memory", "state", "transcript-preserve.lock");

  test("a live lock means another copy is running, so this one skips", () => {
    process.env.PAL_HOME = root;
    mkdirSync(resolve(lockIn(root), ".."), { recursive: true });
    writeFileSync(lockIn(root), "");
    expect(preserveTranscriptsOnce(at)).toBeNull();
  });

  test("a stale lock is taken over and released afterwards", () => {
    process.env.PAL_HOME = root;
    mkdirSync(resolve(lockIn(root), ".."), { recursive: true });
    writeFileSync(lockIn(root), "");
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(lockIn(root), hourAgo, hourAgo);
    writeTranscript("-proj/s1.jsonl", "{}\n");
    expect(preserveTranscriptsOnce(at)?.copied).toBe(1);
    expect(existsSync(lockIn(root))).toBe(false);
  });
});
