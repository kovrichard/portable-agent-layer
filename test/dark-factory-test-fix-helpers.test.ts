import { describe, expect, test } from "bun:test";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";

describe("requestedTestFix", () => {
  test("undefined testFix is no test fix", () => {
    expect(build.requestedTestFix(undefined)).toBeNull();
  });

  test("an empty files list is no test fix", () => {
    expect(build.requestedTestFix({ files: [], change: "x" })).toBeNull();
  });

  test("files given as a string rather than an array is no test fix", () => {
    expect(build.requestedTestFix({ files: "test/a.test.ts", change: "x" })).toBeNull();
  });

  test("one file and a change is returned as given", () => {
    expect(
      build.requestedTestFix({ files: ["test/a.test.ts"], change: "expect 3" })
    ).toEqual({ files: ["test/a.test.ts"], change: "expect 3" });
  });

  test("a missing change becomes an empty string", () => {
    expect(build.requestedTestFix({ files: ["test/a.test.ts"] })).toEqual({
      files: ["test/a.test.ts"],
      change: "",
    });
  });
});

describe("testFixInstructions", () => {
  test("names the file, the change, the answer, and the scope rules", () => {
    const text = build.testFixInstructions(
      { files: ["test/a.test.ts"], change: "expect 3" },
      "criterion 4"
    );
    expect(text).toContain("- test/a.test.ts");
    expect(text).toContain('What must change: "expect 3"');
    expect(text).toContain('The PO\'s answer: "criterion 4"');
    expect(text).toContain("Change only these files");
    expect(text).toContain("uncommitted");
  });

  test("lists every named file one per line", () => {
    const text = build.testFixInstructions(
      { files: ["test/one.test.ts", "test/two.test.ts"], change: "x" },
      "y"
    );
    expect(text).toContain("- test/one.test.ts\n- test/two.test.ts");
  });

  test("an empty change and an empty answer appear as empty quotes", () => {
    const text = build.testFixInstructions(
      { files: ["test/new.test.ts"], change: "" },
      ""
    );
    expect(text).toContain('What must change: ""');
    expect(text).toContain('The PO\'s answer: ""');
  });
});

describe("testFixScopeMessage", () => {
  test("the named file is the only file changed: no message", () => {
    expect(build.testFixScopeMessage(["test/a.test.ts"], ["test/a.test.ts"])).toBeNull();
  });

  test("every named file changed and no other file: no message", () => {
    expect(
      build.testFixScopeMessage(
        ["test/one.test.ts", "test/two.test.ts"],
        ["test/one.test.ts"]
      )
    ).toBeNull();
  });

  test("a named file and an unnamed file changed: stuck names the unnamed file", () => {
    expect(
      build.testFixScopeMessage(["test/a.test.ts"], ["test/a.test.ts", "src/other.ts"])
    ).toBe("the test writer changed files the PO did not name: src/other.ts");
  });

  test("only an unnamed file changed: stuck says the named test was not changed and names the stray", () => {
    expect(build.testFixScopeMessage(["test/a.test.ts"], ["src/other.ts"])).toBe(
      "the test the PO ruled wrong was not changed: the test writer changed none of test/a.test.ts, and changed files the PO did not name: src/other.ts"
    );
  });

  test("nothing changed: stuck says the named test was not changed", () => {
    expect(build.testFixScopeMessage(["test/a.test.ts"], [])).toBe(
      "the test the PO ruled wrong was not changed: the test writer changed none of test/a.test.ts"
    );
  });
});

describe("withFixedTests", () => {
  test("no changed files leaves the answer as it is", () => {
    expect(build.withFixedTests("use 3", [])).toBe("use 3");
  });

  test("one changed file is appended after a blank line", () => {
    expect(build.withFixedTests("use 3", ["test/a.test.ts"])).toBe(
      "use 3\n\nThe test writer changed these test files as the PO answered: test/a.test.ts"
    );
  });

  test("two changed files are listed comma-separated", () => {
    expect(build.withFixedTests("use 3", ["test/a.test.ts", "test/b.test.ts"])).toBe(
      "use 3\n\nThe test writer changed these test files as the PO answered: test/a.test.ts, test/b.test.ts"
    );
  });
});
