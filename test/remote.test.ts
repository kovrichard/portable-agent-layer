import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { detectRemote, normalizeRemote } from "../src/hooks/lib/remote";

describe("normalizeRemote", () => {
  test("every clone style of one repository converges on one value", () => {
    const expected = "github.com/kovrichard/portable-agent-layer";
    expect(normalizeRemote("git@github.com:kovrichard/portable-agent-layer.git")).toBe(
      expected
    );
    expect(normalizeRemote("https://github.com/kovrichard/portable-agent-layer")).toBe(
      expected
    );
    expect(
      normalizeRemote("ssh://git@github.com/kovrichard/portable-agent-layer.git")
    ).toBe(expected);
  });

  // Assembled rather than written inline: a literal user:password@host URL trips
  // the repo's secret scanner, even as an obviously fake example.
  test("strips credentials rather than storing them in a travelling record", () => {
    const credential = ["someone", "not-a-real-token"].join(":");
    expect(normalizeRemote(`https://${credential}@github.com/a/b.git`)).toBe(
      "github.com/a/b"
    );
    expect(normalizeRemote("https://token-only@github.com/a/b.git")).toBe(
      "github.com/a/b"
    );
  });

  test("is case-insensitive across hosts and owners", () => {
    expect(normalizeRemote("git@GitHub.com:Owner/Repo.git")).toBe(
      "github.com/owner/repo"
    );
  });

  // A local remote is just another path, so it identifies nothing portable.
  test("rejects anything that is not a real host", () => {
    expect(normalizeRemote("/srv/git/repo.git")).toBeNull();
    expect(normalizeRemote("file:///srv/git/repo.git")).toBeNull();
    expect(normalizeRemote("../relative/repo")).toBeNull();
    expect(normalizeRemote("github.com")).toBeNull();
    expect(normalizeRemote("")).toBeNull();
  });

  test("keeps a non-default port and nested group paths", () => {
    expect(normalizeRemote("ssh://git@git.example.co.uk:2222/team/sub/repo.git")).toBe(
      "git.example.co.uk:2222/team/sub/repo"
    );
  });
});

describe("detectRemote", () => {
  test("returns null outside a git repository", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "pal-noremote-"));
    try {
      expect(detectRemote(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns null for a git repo that has no origin", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "pal-noorigin-"));
    try {
      spawnSync("git", ["init", "-q", dir]);
      expect(detectRemote(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reads and normalizes a configured origin", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "pal-origin-"));
    try {
      spawnSync("git", ["init", "-q", dir]);
      spawnSync("git", ["-C", dir, "remote", "add", "origin", "git@github.com:a/b.git"]);
      expect(detectRemote(dir)).toBe("github.com/a/b");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
