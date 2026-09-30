import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadFailurePatterns } from "../src/hooks/lib/semi-static";

let HOME: string;
const savedHome = process.env.PAL_HOME;

function capture(slug: string, cwd: string, principle: string) {
  const dir = resolve(HOME, "memory/learning/failures/2026/09", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "capture.md"),
    `---\nrating: 3\ncontext: "ctx"\nprinciple: "${principle}"\nts: 2026-09-20T10:00:00Z\ncwd: ${cwd}\n---\n`
  );
}

function project(name: string, path: string) {
  const dir = resolve(HOME, "memory/projects", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "ISA.md"),
    `---\nname: "${name}"\npath: "${path}"\nstatus: "active"\ncreated: "2026-01-01"\nupdated: "2026-01-01"\n---\n`
  );
}

beforeAll(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-failure-digest-"));
  process.env.PAL_HOME = HOME;
  project("letterbox", "/work/letterbox");
  capture("20260920-100000_a", "/work/letterbox", "letterbox lesson");
  capture("20260920-100001_b", "/work/scratch-tool", "scratch lesson");
});

afterAll(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  rmSync(HOME, { recursive: true, force: true });
});

describe("failure digest labels", () => {
  test("names each lesson's own project, which stays true in any later session", () => {
    const digest = loadFailurePatterns();

    expect(digest).toContain("[letterbox] letterbox lesson");
    expect(digest).toContain("[scratch-tool] scratch lesson");
    expect(digest).not.toContain("[project]");
    expect(digest).not.toContain("[other]");
  });
});
