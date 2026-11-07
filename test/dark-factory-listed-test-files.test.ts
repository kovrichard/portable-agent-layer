import { describe, expect, test } from "bun:test";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";

describe("testFilesTheTaskChanges", () => {
  test("reads a bullet under the section heading", () => {
    const specText = "# t\n\n## Test files this task changes\n\n- test/a.test.ts\n";
    expect(build.testFilesTheTaskChanges(specText)).toEqual(["test/a.test.ts"]);
  });

  test("reads backticked and plain bullets in order", () => {
    const specText =
      "## Test files this task changes\n- `test/a.test.ts`\n- test/b.test.ts\n";
    expect(build.testFilesTheTaskChanges(specText)).toEqual([
      "test/a.test.ts",
      "test/b.test.ts",
    ]);
  });

  test("an empty section lists nothing", () => {
    expect(build.testFilesTheTaskChanges("## Test files this task changes\n\n")).toEqual(
      []
    );
  });

  test("a heading at the wrong level opens no section", () => {
    const specText = "### Test files this task changes\n\n- test/a.test.ts\n";
    expect(build.testFilesTheTaskChanges(specText)).toEqual([]);
  });

  test("a passing mention of the heading in prose opens no section", () => {
    expect(build.testFilesTheTaskChanges("This task changes test/a.test.ts.\n")).toEqual(
      []
    );
  });

  test("an empty spec lists nothing", () => {
    expect(build.testFilesTheTaskChanges("")).toEqual([]);
  });

  test("the section ends at the next heading", () => {
    const specText =
      "## Test files this task changes\n- test/a.test.ts\n\n## Decisions\n\n- 2026-11-07: x\n";
    expect(build.testFilesTheTaskChanges(specText)).toEqual(["test/a.test.ts"]);
  });

  test("bullets outside the section are ignored", () => {
    const specText = "- test/a.test.ts\n## Goal\n- test/b.test.ts\n";
    expect(build.testFilesTheTaskChanges(specText)).toEqual([]);
  });

  test("trailing spaces and empty backticks are tolerated", () => {
    const specText = "## Test files this task changes   \n-   test/a.test.ts  \n- ``\n";
    expect(build.testFilesTheTaskChanges(specText)).toEqual(["test/a.test.ts"]);
  });

  test("CRLF line endings are tolerated", () => {
    const specText = "## Test files this task changes\r\n- test/a.test.ts\r\n";
    expect(build.testFilesTheTaskChanges(specText)).toEqual(["test/a.test.ts"]);
  });
});
