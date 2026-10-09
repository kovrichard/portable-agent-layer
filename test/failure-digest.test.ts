import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadFailurePatterns } from "../src/hooks/lib/semi-static";
import { freshTestDir } from "./lib/test-home";

let HOME: string;

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
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
  project("letterbox", "/work/letterbox");
  capture("20260920-100000_a", "/work/letterbox", "letterbox lesson");
  capture("20260920-100001_b", "/work/scratch-tool", "scratch lesson");
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
