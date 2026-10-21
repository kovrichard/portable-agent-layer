import { beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { appendEvent, readTree } from "../src/hooks/lib/progress-tree";
import { loadProgressTreeContext } from "../src/hooks/lib/progress-tree-context";
import { ghPrView } from "../src/hooks/lib/progress-tree-prs";
import { reload } from "../src/hooks/lib/settings";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

const OPENED = new Date("2026-10-01T09:00:00Z");
const MERGED_AT = "2026-10-19T10:00:00Z";
const CLOSED_AT = "2026-10-18T08:30:00Z";

let home: string;
let folder: string;
let ghDir: string;
let ghLog: string;
const originalPath = process.env.PATH;

function prUrl(n: number): string {
  return `https://github.com/acme/repo/pull/${n}`;
}

function fakeGhScript(): string {
  return [
    'import { appendFileSync, closeSync, existsSync, readFileSync } from "node:fs";',
    'import { join } from "node:path";',
    `const dir = ${JSON.stringify(ghDir)};`,
    "const args = process.argv.slice(2);",
    `appendFileSync(${JSON.stringify(ghLog)}, args.join(" ") + "\\n");`,
    'const n = (args.at(-1) ?? "").split("/").pop();',
    "const marker = (ext) => join(dir, n + ext);",
    'if (existsSync(marker(".sleep"))) { closeSync(1); closeSync(2); setTimeout(() => {}, 10_000); }',
    'else if (existsSync(marker(".fail"))) { console.error("gh: not logged in"); process.exit(1); }',
    'else if (existsSync(marker(".json"))) process.stdout.write(readFileSync(marker(".json")));',
    "else process.exit(1);",
    "",
  ].join("\n");
}

function writeFakeGhLauncher(bin: string) {
  if (process.platform === "win32") {
    writeFileSync(resolve(bin, "gh.js"), fakeGhScript());
    writeFileSync(resolve(bin, "gh.cmd"), `@echo off\r\nbun "%~dp0gh.js" %*\r\n`);
    return;
  }
  writeFileSync(resolve(bin, "gh"), `#!/usr/bin/env bun\n${fakeGhScript()}`);
  chmodSync(resolve(bin, "gh"), 0o755);
}

function installFakeGh() {
  ghDir = resolve(home, "fake-gh");
  mkdirSync(ghDir, { recursive: true });
  ghLog = resolve(ghDir, "calls.log");
  const bin = resolve(ghDir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFakeGhLauncher(bin);
  process.env.PATH = `${bin}${delimiter}${originalPath}`;
}

function removeGhFromPath() {
  process.env.PATH = resolve(ghDir, "empty-bin");
}

function prState(n: number, state: "MERGED" | "CLOSED" | "OPEN") {
  const closedDates = { MERGED: MERGED_AT, CLOSED: CLOSED_AT, OPEN: null };
  const body = {
    state,
    mergedAt: state === "MERGED" ? MERGED_AT : null,
    closedAt: closedDates[state],
  };
  writeFileSync(resolve(ghDir, `${n}.json`), JSON.stringify(body));
}

function ghCalls(): string[] {
  if (!existsSync(ghLog)) return [];
  return readFileSync(ghLog, "utf-8").split("\n").filter(Boolean);
}

function setProgressTree(on: boolean) {
  mkdirSync(resolve(home, "memory"), { recursive: true });
  writeFileSync(
    resolve(home, "memory", "pal-settings.json"),
    JSON.stringify({ dynamicContext: { progressTree: on } })
  );
  reload();
}

function openNodeWithPr(node: string, ...prs: number[]) {
  appendEvent(
    folder,
    node,
    "open",
    { title: `Work ${node}`, parent: null },
    undefined,
    OPENED
  );
  prs.forEach((n, i) => {
    appendEvent(
      folder,
      node,
      "attach",
      { kind: "pr", ref: prUrl(n) },
      undefined,
      new Date(OPENED.getTime() + (i + 1) * 60_000)
    );
  });
  appendEvent(
    folder,
    node,
    "stopped",
    { text: "CI running" },
    undefined,
    new Date(OPENED.getTime() + 3_600_000)
  );
}

function stoppedAt(node: string): string | null {
  return readTree(folder).nodes.get(node)?.stoppedAt ?? null;
}

beforeEach(() => {
  process.env.PATH = originalPath;
  home = freshTestDir(import.meta.file);
  folder = resolve(home, "some-folder");
  mkdirSync(folder, { recursive: true });
  process.env.PAL_HOME = home;
  setProgressTree(true);
  installFakeGh();
});

describe("a session start refreshes stopped-at lines from the PRs on open nodes", () => {
  test("a merged PR writes 'PR #n merged <date>' and the rendered context shows it", () => {
    openNodeWithPr("n1", 126);
    prState(126, "MERGED");
    const context = loadProgressTreeContext(folder);
    expect(stoppedAt("n1")).toBe("PR #126 merged 2026-10-19");
    expect(context).toContain("PR #126 merged 2026-10-19");
  });

  test("a PR closed without merging writes 'PR #n closed without merging <date>'", () => {
    openNodeWithPr("n1", 127);
    prState(127, "CLOSED");
    loadProgressTreeContext(folder);
    expect(stoppedAt("n1")).toBe("PR #127 closed without merging 2026-10-18");
  });

  test("an open PR changes nothing", () => {
    openNodeWithPr("n1", 128);
    prState(128, "OPEN");
    loadProgressTreeContext(folder);
    expect(stoppedAt("n1")).toBe("CI running");
    expect(ghCalls()).toHaveLength(1);
  });

  test("an earlier PR that merged writes the line while a later one is still open", () => {
    openNodeWithPr("n1", 126, 133);
    prState(126, "MERGED");
    prState(133, "OPEN");
    loadProgressTreeContext(folder);
    expect(stoppedAt("n1")).toBe("PR #126 merged 2026-10-19");
  });

  test("the latest PR merged wins over an earlier closed one", () => {
    openNodeWithPr("n1", 126, 133);
    prState(126, "CLOSED");
    prState(133, "MERGED");
    loadProgressTreeContext(folder);
    expect(stoppedAt("n1")).toBe("PR #133 merged 2026-10-19");
  });
});

describe("a newer line wins", () => {
  test("a stopped-at line written after the merge is left alone", () => {
    openNodeWithPr("n1", 126);
    appendEvent(
      folder,
      "n1",
      "stopped",
      { text: "follow-up work planned" },
      undefined,
      new Date("2026-10-19T12:00:00Z")
    );
    prState(126, "MERGED");
    loadProgressTreeContext(folder);
    expect(stoppedAt("n1")).toBe("follow-up work planned");
  });
});

describe("a merged or closed PR is never checked again", () => {
  test("the second start makes no gh call for a merged PR", () => {
    openNodeWithPr("n1", 126);
    prState(126, "MERGED");
    loadProgressTreeContext(folder);
    expect(ghCalls()).toHaveLength(1);
    loadProgressTreeContext(folder);
    expect(ghCalls()).toHaveLength(1);
    expect(stoppedAt("n1")).toBe("PR #126 merged 2026-10-19");
  });

  test("the second start makes no gh call for a closed PR", () => {
    openNodeWithPr("n1", 127);
    prState(127, "CLOSED");
    loadProgressTreeContext(folder);
    loadProgressTreeContext(folder);
    expect(ghCalls()).toHaveLength(1);
  });

  test("an open PR is checked at every start", () => {
    openNodeWithPr("n1", 128);
    prState(128, "OPEN");
    loadProgressTreeContext(folder);
    loadProgressTreeContext(folder);
    expect(ghCalls()).toHaveLength(2);
  });
});

describe("session start never fails because of this", () => {
  test("gh missing writes nothing and does not throw", () => {
    openNodeWithPr("n1", 126);
    prState(126, "MERGED");
    removeGhFromPath();
    expect(() => loadProgressTreeContext(folder)).not.toThrow();
    expect(stoppedAt("n1")).toBe("CI running");
  });

  test("gh failing (not logged in, unreadable URL) writes nothing and does not throw", () => {
    openNodeWithPr("n1", 126);
    writeFileSync(resolve(ghDir, "126.fail"), "");
    expect(() => loadProgressTreeContext(folder)).not.toThrow();
    expect(stoppedAt("n1")).toBe("CI running");
  });

  test("gh printing garbage writes nothing and does not throw", () => {
    openNodeWithPr("n1", 126);
    writeFileSync(resolve(ghDir, "126.json"), "not json");
    expect(() => loadProgressTreeContext(folder)).not.toThrow();
    expect(stoppedAt("n1")).toBe("CI running");
  });

  test("a gh that never answers is cut off at the time it was given and gives no reply", () => {
    writeFileSync(resolve(ghDir, "301.sleep"), "");
    const started = Date.now();
    expect(ghPrView(prUrl(301), folder, 300)).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
    expect(ghCalls()).toHaveLength(1);
    removeOnceReleased(resolve(ghDir, "301.sleep"));
  });
});

describe("what the check does not touch", () => {
  test("the node is not marked done and nothing else changes", () => {
    openNodeWithPr("n1", 126);
    openNodeWithPr("n2", 127);
    prState(126, "MERGED");
    prState(127, "OPEN");
    const before = readTree(folder);
    loadProgressTreeContext(folder);
    const after = readTree(folder);
    expect(after.nodes.get("n1")?.status).toBe(before.nodes.get("n1")?.status);
    expect(after.nodes.get("n1")?.status).not.toBe("done");
    expect(after.nodes.get("n1")?.parent).toBe(before.nodes.get("n1")?.parent);
    expect(after.nodes.get("n2")).toEqual(before.nodes.get("n2"));
  });

  test("a done node is not checked", () => {
    openNodeWithPr("n1", 126);
    appendEvent(folder, "n1", "done", {}, undefined, new Date("2026-10-05T00:00:00Z"));
    prState(126, "MERGED");
    loadProgressTreeContext(folder);
    expect(ghCalls()).toHaveLength(0);
  });

  test("a node with no PR attached makes no gh call", () => {
    appendEvent(
      folder,
      "n1",
      "open",
      { title: "No PR", parent: null },
      undefined,
      OPENED
    );
    loadProgressTreeContext(folder);
    expect(ghCalls()).toHaveLength(0);
  });

  test("with the progress tree off, no gh call is made", () => {
    openNodeWithPr("n1", 126);
    prState(126, "MERGED");
    setProgressTree(false);
    loadProgressTreeContext(folder);
    expect(ghCalls()).toHaveLength(0);
    expect(stoppedAt("n1")).toBe("CI running");
  });
});
