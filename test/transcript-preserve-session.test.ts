import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  preserveSessionTranscript,
  preserveTranscripts,
} from "../src/bronze/transcript-preserve";
import { freshTestDir } from "./lib/test-home";

let root: string;
let at: { source: string; target: string; manifest: string };

function writeTranscript(rel: string, body: string): string {
  const file = resolve(at.source, rel);
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, body);

  return file;
}

const copiedExists = (rel: string) => existsSync(resolve(at.target, `${rel}.gz`));

beforeEach(() => {
  root = freshTestDir(import.meta.file);
  at = {
    source: resolve(root, "projects"),
    target: resolve(root, "content", "claude"),
    manifest: resolve(root, "state", "transcript-copies.json"),
  };
});

describe("preserveSessionTranscript", () => {
  test("copies the closing session and its subagents, and no other session", async () => {
    const own = writeTranscript("-sales/job.jsonl", '{"a":1}\n');
    writeTranscript("-sales/job/subagents/agent-x.jsonl", '{"b":2}\n');
    writeTranscript("-sales/other.jsonl", '{"c":3}\n');
    expect(await preserveSessionTranscript(own, at)).toEqual({
      copied: 2,
      unchanged: 0,
      failed: 0,
    });
    expect(copiedExists("-sales/job.jsonl")).toBe(true);
    expect(copiedExists("-sales/job/subagents/agent-x.jsonl")).toBe(true);
    expect(copiedExists("-sales/other.jsonl")).toBe(false);
    expect(
      new TextDecoder().decode(
        Bun.gunzipSync(readFileSync(resolve(at.target, "-sales/job.jsonl.gz")))
      )
    ).toBe('{"a":1}\n');
  });

  test("the full sweep after it does not copy the session again", async () => {
    const own = writeTranscript("-sales/job.jsonl", '{"a":1}\n');
    await preserveSessionTranscript(own, at);
    expect(await preserveTranscripts(at)).toEqual({ copied: 0, unchanged: 1, failed: 0 });
  });

  test("a path outside Claude Code's projects folder, or none, copies nothing", async () => {
    const outside = resolve(root, "elsewhere", "s.jsonl");
    mkdirSync(resolve(outside, ".."), { recursive: true });
    writeFileSync(outside, "{}\n");
    expect(await preserveSessionTranscript(outside, at)).toBeNull();
    expect(await preserveSessionTranscript(undefined, at)).toBeNull();
    expect(
      await preserveSessionTranscript(resolve(at.source, "../x.jsonl"), at)
    ).toBeNull();
  });
});
