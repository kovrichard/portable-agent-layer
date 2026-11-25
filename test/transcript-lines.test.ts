import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type TranscriptLine,
  transcriptBytes,
  transcriptLines,
} from "../src/bronze/transcript-lines";
import { freshTestDir } from "./lib/test-home";

let plain: string;
let gzipped: string;

async function collected(path: string, offset = 0): Promise<TranscriptLine[]> {
  const lines: TranscriptLine[] = [];

  for await (const line of transcriptLines(path, offset)) lines.push(line);

  return lines;
}

/** Lines long enough to cross the 1 MiB chunk, with multi-byte text that can be cut mid-character. */
function body(): string {
  const lines = Array.from({ length: 40 }, (_, i) =>
    JSON.stringify({ i, text: `${"ő€😀".repeat(9000 + i * 37)}` })
  );

  return `${lines.join("\n")}\n{"unfinished":`;
}

beforeEach(() => {
  const dir = freshTestDir(import.meta.file);
  plain = resolve(dir, "s.jsonl");
  gzipped = resolve(dir, "s.jsonl.gz");
  writeFileSync(plain, body());
  writeFileSync(gzipped, Bun.gzipSync(readFileSync(plain)));
});

describe("transcriptLines", () => {
  test("yields every complete line whole, across chunk boundaries", async () => {
    const expected = body().split("\n").slice(0, -1);
    expect((await collected(plain)).map((l) => l.text)).toEqual(expected);
  });

  test("each line's start and end are its byte positions in the file", async () => {
    const bytes = readFileSync(plain);

    for (const line of await collected(plain)) {
      expect(bytes.toString("utf-8", line.start, line.end - 1)).toBe(line.text);
      expect(bytes[line.end - 1]).toBe(10);
    }
  });

  test("a last line no newline has ended is left for the next read", async () => {
    const lines = await collected(plain);
    expect(lines.at(-1)?.text).not.toContain("unfinished");
    expect(await collected(plain, lines.at(-1)?.end)).toEqual([]);
  });

  test("reading on from an offset gives the lines after it", async () => {
    const all = await collected(plain);
    expect(await collected(plain, all[25].start)).toEqual(all.slice(25));
  });

  test("a gzipped copy reads the same lines at the same offsets", async () => {
    const all = await collected(plain);
    expect(await collected(gzipped)).toEqual(all);
    expect(await collected(gzipped, all[25].start)).toEqual(all.slice(25));
  });
});

describe("transcriptBytes", () => {
  test("a gzipped copy's length is the original's, read from its trailer", () => {
    expect(transcriptBytes(gzipped)).toBe(readFileSync(plain).length);
    expect(transcriptBytes(plain)).toBe(readFileSync(plain).length);
  });
});
