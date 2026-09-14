import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { toPath } from "../src/hooks/lib/paths";

const HOME = homedir();

describe("toPath — the one place a foreign path string becomes a real path", () => {
  test("expands a bare tilde to the home directory", () => {
    expect(toPath("~")).toBe(HOME);
  });

  test("expands a leading tilde segment", () => {
    expect(toPath("~/notes.md")).toBe(resolve(HOME, "notes.md"));
  });

  // Windows is the whole reason this exists, and there a user types backslashes.
  test("expands a leading tilde written with a backslash", () => {
    expect(toPath("~\\notes.md")).toBe(resolve(HOME, "notes.md"));
  });

  // The bug this replaces: context.ts did file.replace("~", home), which is
  // unanchored, so "/tmp/a~b/c" became "/tmp/a<home>b/c".
  test("leaves a tilde that is not the first segment alone", () => {
    expect(toPath("/tmp/a~b/c.md")).toBe(resolve("/tmp/a~b/c.md"));
    expect(toPath("/srv/~backup/x.md")).toBe(resolve("/srv/~backup/x.md"));
  });

  test("a tilde inside a filename survives", () => {
    expect(toPath("/tmp/report~final.pdf")).toBe(resolve("/tmp/report~final.pdf"));
  });

  // ~user needs a passwd lookup. Treating it as a relative directory is exactly
  // how the original bug behaved, so refuse rather than half-support it.
  test("refuses ~user rather than silently treating it as a directory", () => {
    expect(() => toPath("~otheruser/notes.md")).toThrow(/not supported/);
    expect(() => toPath("~root")).toThrow(/not supported/);
  });

  test("makes a relative path absolute against the cwd by default", () => {
    expect(toPath("notes.md")).toBe(resolve(process.cwd(), "notes.md"));
  });

  test("resolves a relative path against an explicit base when given one", () => {
    expect(toPath("notes.md", "/srv/data")).toBe(resolve("/srv/data", "notes.md"));
  });

  test("the base is ignored once the input is absolute", () => {
    expect(toPath(resolve("/etc/hosts"), "/srv/data")).toBe(resolve("/etc/hosts"));
  });

  test("an already-absolute path comes back normalized, not rewritten", () => {
    expect(toPath("/tmp/./a/../b")).toBe(resolve("/tmp/b"));
  });

  test("is idempotent — normalizing twice changes nothing", () => {
    const once = toPath("~/deck/talk");
    expect(toPath(once)).toBe(once);
  });

  test("an empty string is the base, not the home", () => {
    expect(toPath("", "/srv/data")).toBe(resolve("/srv/data"));
  });

  test("returns a path in this platform's separator", () => {
    expect(toPath("~/a/b")).toContain(sep);
  });
});
