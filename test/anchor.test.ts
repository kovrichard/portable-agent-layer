import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { ProjectProgress } from "../src/hooks/lib/projects";

function project(name: string, path: string): ProjectProgress {
  return { name, path, status: "active", created: "2026-01-01", updated: "2026-01-01" };
}

async function lib() {
  return await import("../src/hooks/lib/anchor");
}

describe("isAnchor", () => {
  test("recognizes the {proj:slug} form", async () => {
    const { isAnchor } = await lib();
    expect(isAnchor("{proj:widget}/src/foo.ts")).toBe(true);
    expect(isAnchor("{proj:widget}")).toBe(true);
  });

  test("rejects a plain absolute path", async () => {
    const { isAnchor } = await lib();
    expect(isAnchor("/home/dev/git/widget/src/foo.ts")).toBe(false);
  });

  test("rejects a slug with characters outside [a-z0-9_-]", async () => {
    const { isAnchor } = await lib();
    expect(isAnchor("{proj:Letter Box}/foo.ts")).toBe(false);
  });

  test("rejects an unclosed or malformed brace", async () => {
    const { isAnchor } = await lib();
    expect(isAnchor("{proj:widget/foo.ts")).toBe(false);
    expect(isAnchor("proj:widget}/foo.ts")).toBe(false);
  });

  test("requires the pattern to consume the whole string, not just a prefix", async () => {
    const { isAnchor } = await lib();
    expect(isAnchor("{proj:widget}garbage")).toBe(false);
    expect(isAnchor("{proj:widget}/src.tsextra")).toBe(true); // legitimate: /src.tsextra is a valid relative segment
  });
});

describe("encodeAnchor", () => {
  const projects = [
    project("widget", "/home/dev/git/widget"),
    project("widget-docs", "/home/dev/git/widget-docs"),
  ];

  test("rewrites a path inside a registered project", async () => {
    const { encodeAnchor } = await lib();
    expect(encodeAnchor("/home/dev/git/widget/src/foo.ts", projects)).toBe(
      "{proj:widget}/src/foo.ts"
    );
  });

  test("the project root itself has no trailing slash", async () => {
    const { encodeAnchor } = await lib();
    expect(encodeAnchor("/home/dev/git/widget", projects)).toBe("{proj:widget}");
  });

  test("passes through a path outside every registered project", async () => {
    const { encodeAnchor } = await lib();
    expect(encodeAnchor("/home/dev/scratch/notes", projects)).toBe(
      "/home/dev/scratch/notes"
    );
  });

  test("picks the longest matching project when one path prefixes another", async () => {
    const { encodeAnchor } = await lib();
    expect(encodeAnchor("/home/dev/git/widget-docs/README.md", projects)).toBe(
      "{proj:widget-docs}/README.md"
    );
  });

  test("does not treat a same-prefix sibling directory as a match", async () => {
    const { encodeAnchor } = await lib();
    // "widget-docs" must not be matched as if it were inside "widget".
    const result = encodeAnchor("/home/dev/git/widget-docs/README.md", [
      project("widget", "/home/dev/git/widget"),
    ]);
    expect(result).toBe("/home/dev/git/widget-docs/README.md");
  });
});

describe("resolveAnchor", () => {
  const projects = [project("widget", "/home/dev/git/widget")];

  test("resolves a known anchor to a local absolute path", async () => {
    const { resolveAnchor } = await lib();
    const r = resolveAnchor("{proj:widget}/src/foo.ts", projects);
    expect(r).toEqual({
      state: "anchored",
      path: resolve("/home/dev/git/widget/src/foo.ts"),
    });
  });

  test("resolves the bare project anchor to the project root", async () => {
    const { resolveAnchor } = await lib();
    const r = resolveAnchor("{proj:widget}", projects);
    expect(r).toEqual({ state: "anchored", path: resolve("/home/dev/git/widget") });
  });

  test("reports unresolvable when the slug is not registered here", async () => {
    const { resolveAnchor } = await lib();
    const r = resolveAnchor("{proj:gizmo}/README.md", projects);
    expect(r).toEqual({ state: "unresolvable", slug: "gizmo" });
  });

  test("passes a plain non-anchor value through unchanged", async () => {
    const { resolveAnchor } = await lib();
    const r = resolveAnchor("/some/random/path", projects);
    expect(r).toEqual({ state: "plain", path: "/some/random/path" });
  });

  test("round-trips encodeAnchor's output back to the original absolute path", async () => {
    const { encodeAnchor, resolveAnchor } = await lib();
    const original = resolve("/home/dev/git/widget/src/deep/nested/foo.ts");
    const encoded = encodeAnchor(original, projects);
    const decoded = resolveAnchor(encoded, projects);
    expect(decoded).toEqual({ state: "anchored", path: original });
  });
});

describe("anchorMatchesCwd", () => {
  const projects = [project("widget", "/home/dev/git/widget")];

  test("matches when the anchor resolves to the given cwd", async () => {
    const { anchorMatchesCwd } = await lib();
    expect(
      anchorMatchesCwd("{proj:widget}/src", "/home/dev/git/widget/src", projects)
    ).toBe(true);
  });

  test("does not match a different path under the same project", async () => {
    const { anchorMatchesCwd } = await lib();
    expect(
      anchorMatchesCwd("{proj:widget}/src", "/home/dev/git/widget/test", projects)
    ).toBe(false);
  });

  test("an unresolvable anchor never matches, regardless of cwd", async () => {
    const { anchorMatchesCwd } = await lib();
    expect(anchorMatchesCwd("{proj:unknown}/src", "/home/dev/git/widget", projects)).toBe(
      false
    );
  });

  test("a plain absolute path still matches by direct equality", async () => {
    const { anchorMatchesCwd } = await lib();
    expect(anchorMatchesCwd("/home/dev/git/widget", "/home/dev/git/widget", [])).toBe(
      true
    );
  });
});

describe("relocation — the actual payoff", () => {
  test("changing a project's registered path re-resolves every anchor referencing it", async () => {
    const { encodeAnchor, resolveAnchor } = await lib();
    const before = [project("widget", "/home/dev/git/widget")];
    const anchor = encodeAnchor("/home/dev/git/widget/src/foo.ts", before);

    // The project moves — same slug, new path. No anchor is rewritten.
    const after = [project("widget", "/mnt/data/widget")];
    const resolved = resolveAnchor(anchor, after);

    expect(resolved).toEqual({
      state: "anchored",
      path: resolve("/mnt/data/widget/src/foo.ts"),
    });
  });
});
