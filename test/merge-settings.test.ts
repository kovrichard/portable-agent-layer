import { describe, expect, test } from "bun:test";
import { mergeSettings } from "../src/targets/lib";

describe("mergeSettings — deprecated permission cleanup", () => {
  test("strips ineffective Grep()/Glob() rules left by older templates", () => {
    const existing = {
      permissions: {
        allow: ["Read(//*)", "Grep(//*)", "Glob(//*)", "Grep", "Glob", "WebFetch"],
      },
    };
    const template = { permissions: { allow: ["Read(//*)"] } };

    const merged = mergeSettings(existing, template);
    const allow = merged.permissions?.allow ?? [];

    // Path-scoped Grep()/Glob() are removed — they trigger the Claude Code warning.
    expect(allow).not.toContain("Grep(//*)");
    expect(allow).not.toContain("Glob(//*)");
    // Read(//*) covers file-reading tools and must survive.
    expect(allow).toContain("Read(//*)");
    // Bare tool allows and unrelated rules are untouched.
    expect(allow).toContain("Grep");
    expect(allow).toContain("Glob");
    expect(allow).toContain("WebFetch");
  });

  test("does not re-add Grep()/Glob() even if a stale template still lists them", () => {
    const existing = { permissions: { allow: ["Read(//*)"] } };
    const template = {
      permissions: { allow: ["Read(//*)", "Grep(//*)", "Glob(//*)"] },
    };

    const merged = mergeSettings(existing, template);
    const allow = merged.permissions?.allow ?? [];

    expect(allow).not.toContain("Grep(//*)");
    expect(allow).not.toContain("Glob(//*)");
    expect(allow).toContain("Read(//*)");
  });
});
