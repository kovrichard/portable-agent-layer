import { beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { posix, resolve, win32 } from "node:path";
import { boundProjectAt, projectRootContaining } from "../src/core/project-bindings";
import { freshTestDir } from "./lib/test-home";

describe("projectRootContaining", () => {
  const roots = {
    widget: "/home/dev/git/widget",
    "widget-docs": "/home/dev/git/widget-docs",
  };

  test("a cwd equal to a root names that project", () => {
    expect(projectRootContaining("/home/dev/git/widget", roots, posix)).toBe("widget");
  });

  test("a folder nested under a root names that project", () => {
    expect(projectRootContaining("/home/dev/git/widget/src/deep", roots, posix)).toBe(
      "widget"
    );
  });

  test("the longest containing root wins", () => {
    const nested = { outer: "/home/dev/git", inner: "/home/dev/git/widget" };
    expect(projectRootContaining("/home/dev/git/widget/src", nested, posix)).toBe(
      "inner"
    );
  });

  test("on equal length the earlier entry wins", () => {
    const twins = { first: "/home/dev/a", second: "/home/dev/a" };
    expect(projectRootContaining("/home/dev/a/src", twins, posix)).toBe("first");
  });

  test("a sibling sharing a name prefix is not inside the shorter root", () => {
    expect(
      projectRootContaining("/home/dev/git/widget-docs/README.md", roots, posix)
    ).toBe("widget-docs");
    expect(
      projectRootContaining(
        "/home/dev/git/widget-docs",
        { widget: "/home/dev/git/widget" },
        posix
      )
    ).toBeNull();
  });

  test("on Windows both sides are compared case-folded", () => {
    const windowsRoots = { widget: "C:\\Users\\Dev\\Widget" };
    expect(
      projectRootContaining("c:\\users\\dev\\widget\\src", windowsRoots, win32)
    ).toBe("widget");
  });

  test("a folder outside every root names no project", () => {
    expect(projectRootContaining("/home/dev/scratch", roots, posix)).toBeNull();
  });
});

describe("boundProjectAt", () => {
  let home: string;

  beforeEach(() => {
    home = freshTestDir(import.meta.file);
    process.env.PAL_HOME = home;
  });

  test("reads the bindings of the PAL home and names the project holding the cwd", () => {
    const gizmo = resolve(home, "checkouts", "gizmo");
    writeFileSync(resolve(home, "bindings.json"), JSON.stringify({ gizmo }));
    expect(boundProjectAt(resolve(gizmo, "src"))).toBe("gizmo");
    expect(boundProjectAt(resolve(home, "elsewhere"))).toBeNull();
  });
});
