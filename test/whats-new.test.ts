import { describe, expect, test } from "bun:test";
import { notesLink } from "../src/cli/install-flow";
import {
  newer,
  noteText,
  type Release,
  releaseNotes,
  summarizeReleases,
  whatsNew,
} from "../src/cli/whats-new";

const body = (features: string[], fixes: string[] = []) =>
  [
    "## [0.90.0](https://example.test/compare) (2026-10-08)",
    "",
    "### Features",
    "",
    ...features.map((f) => `* **scope:** ${f} ([abc1234](https://example.test/c))`),
    "",
    "### Bug Fixes",
    "",
    ...fixes.map((f) => `* ${f} ([def5678](https://example.test/c))`),
    "",
    "### Performance Improvements",
    "",
    "* faster thing",
  ].join("\n");

describe("a release note", () => {
  test("reads as a sentence, without scope or commit link", () => {
    expect(noteText("* **rating:** confirm corrections ([abc](https://x))")).toBe(
      "Confirm corrections"
    );
  });

  test("is taken from features, then fixes, and nothing else", () => {
    expect(releaseNotes(body(["add a"], ["fix b"]))).toEqual(["Add a", "Fix b"]);
  });
});

describe("which releases are new", () => {
  test("compares versions by number, not text", () => {
    expect(newer("0.10.0", "0.9.9")).toBe(true);
    expect(newer("v0.90.0", "0.90.0")).toBe(false);
    expect(newer("0.89.1", "0.90.0")).toBe(false);
  });

  const releases: Release[] = [
    { tag_name: "v0.91.0", body: body(["too new"]) },
    { tag_name: "v0.90.0", body: body(["one", "two"], ["three"]) },
    { tag_name: "v0.89.1", body: body(["four"]) },
    { tag_name: "v0.89.0", body: body(["already had"]) },
  ];

  test("only those after the old version, up to the new one", () => {
    const news = summarizeReleases(releases, "0.89.0", "0.90.0", "o/r");

    expect(news).toEqual({
      items: ["One", "Two", "Three"],
      more: 1,
      url: "github.com/o/r/releases/tag/v0.90.0",
    });
  });

  test("nothing when no release in the range has notes", () => {
    expect(summarizeReleases(releases, "0.90.0", "0.90.0", "o/r")).toBeNull();
  });

  test("an update never waits on GitHub", async () => {
    const offline = () => Promise.reject(new Error("offline"));

    expect(await whatsNew("0.89.0", "0.90.0", offline)).toBeNull();
  });
});

describe("the link to all notes", () => {
  test("says how many more there are", () => {
    expect(notesLink("github.com/o/r/releases/tag/v1", 0, 80)).toEqual([
      "all notes:",
      "github.com/o/r/releases/tag/v1",
    ]);
    expect(notesLink("github.com/o/r/releases/tag/v1", 4, 80)[0]).toBe("4 more:");
  });

  test("shortens the repository when the link would not fit", () => {
    expect(notesLink("github.com/owner/repository/releases/tag/v1", 0, 40)[1]).toBe(
      "github.com/…/releases/tag/v1"
    );
  });
});
