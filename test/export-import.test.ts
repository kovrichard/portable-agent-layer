import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import * as readline from "node:readline";
import AdmZip from "adm-zip";
import { exportState, importState } from "../src/cli/export-import";
import { readRegistry } from "../src/hooks/lib/machine";
import { narrateSteps } from "../src/targets/log";
import { freshTestDir } from "./lib/test-home";

const realCreateInterface = readline.createInterface;
let typedAnswer: string | undefined;
let prompts: string[];
let closedPrompts: number;

function fakeInterface() {
  return {
    question: (prompt: string, answer: (a: string) => void) => {
      prompts.push(prompt);
      answer(typedAnswer ?? "");
    },
    close: () => {
      closedPrompts++;
    },
  };
}

mock.module("node:readline", () => ({
  ...readline,
  createInterface: (...args: Parameters<typeof realCreateInterface>) =>
    typedAnswer === undefined ? realCreateInterface(...args) : fakeInterface(),
}));

class Exited extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

let home: string;
let printed: string[];

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  printed = [];
  prompts = [];
  closedPrompts = 0;
  narrateSteps(true);
});

function capture(...a: unknown[]) {
  printed.push(a.join(" "));
}

function exitByThrowing(code?: number | string | null): never {
  throw new Exited(code as number | undefined);
}

async function cli(
  command: (args: string[]) => Promise<void>,
  args: string[],
  answer = "y"
): Promise<void> {
  typedAnswer = answer;
  const spies = [
    spyOn(console, "log").mockImplementation(capture),
    spyOn(console, "error").mockImplementation(capture),
    spyOn(process, "exit").mockImplementation(exitByThrowing),
  ];

  try {
    await command(args);
  } finally {
    typedAnswer = undefined;

    for (const spy of spies) spy.mockRestore();
  }
}

const output = () => printed.join("\n");

function writeAt(root: string, rel: string, text: string): string {
  const path = resolve(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);

  return path;
}

function archive(path: string, files: Record<string, string>, ageSeconds = 0): string {
  const zip = new AdmZip();

  for (const [name, text] of Object.entries(files)) zip.addFile(name, Buffer.from(text));
  mkdirSync(dirname(path), { recursive: true });
  zip.writeZip(path);
  const when = new Date(Date.now() - ageSeconds * 1000);
  utimesSync(path, when, when);

  return path;
}

function importLog(): Record<string, unknown>[] {
  return readFileSync(resolve(home, "memory", "state", "import-log.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

const elsewhere = () => freshTestDir(import.meta.file);

const exportNamePattern = /pal-export-\d{14}\.zip\n$/;

describe("exportState", () => {
  test("a dry run with nothing to export says so", async () => {
    await cli(exportState, ["--dry-run"]);
    expect(printed).toEqual(["Nothing to export."]);
  });

  test("a dry run lists the files it would put in an archive under PAL_HOME", async () => {
    writeAt(home, "telos/GOALS.md", "goals");
    writeAt(home, "memory/notes.md", "notes");
    await cli(exportState, ["--dry-run"]);
    const [header, ...files] = printed;
    expect(header).toStartWith(`Would export 2 files → ${resolve(home, "pal-export-")}`);
    expect(header).toMatch(exportNamePattern);
    expect(files.sort()).toEqual(["  memory/notes.md", "  telos/GOALS.md"]);
    expect(readdirSync(home).some((f) => f.endsWith(".zip"))).toBe(false);
  });

  test("a folder argument places the archive in that folder", async () => {
    writeAt(home, "telos/GOALS.md", "goals");
    const target = elsewhere();
    await cli(exportState, ["--dry-run", target]);
    expect(printed[0]).toStartWith(
      `Would export 1 files → ${resolve(target, "pal-export-")}`
    );
    expect(printed[0]).toMatch(exportNamePattern);
  });

  test("writes the archive to a file argument and reports the count", async () => {
    writeAt(home, "telos/GOALS.md", "goals");
    writeAt(home, "memory/notes.md", "notes");
    const out = resolve(elsewhere(), "mine.zip");
    await cli(exportState, [out]);
    const names = new AdmZip(out).getEntries().map((e) => e.entryName);
    expect(names).toContain("telos/GOALS.md");
    expect(names).toContain("memory/notes.md");
    expect(printed).toEqual([`Exported ${names.length - 1} files → ${out}`]);
  });
});

describe("importState with an explicit archive", () => {
  test("merges new files, records the source machine and logs the import", async () => {
    const zipPath = archive(resolve(elsewhere(), "in.zip"), {
      "telos/GOALS.md": "goals",
      "export-manifest.json": JSON.stringify({
        machineId: "m-source",
        label: "laptop",
        os: "linux",
      }),
    });
    await cli(importState, [zipPath]);

    expect(readFileSync(resolve(home, "telos/GOALS.md"), "utf-8")).toBe("goals");
    expect(output()).toContain("Source machine: laptop (m-source)");
    expect(output()).toContain(
      `Imported → ${home}: 1 new, 0 merged (+0 records), 0 unchanged, 1 skipped`
    );
    expect(output()).toContain("Run 'pal cli install' to re-register hooks.");
    expect(output()).not.toContain("diverged");
    expect(readRegistry()).toContainEqual({
      id: "m-source",
      label: "laptop",
      os: "linux",
    });
    expect(importLog()).toEqual([
      expect.objectContaining({
        archive: zipPath,
        mode: "merge",
        created: 1,
        merged: 0,
        identical: 0,
        conflicts: 0,
        skipped: 1,
        linesAdded: 0,
        quarantineDir: null,
        sourceMachineId: "m-source",
      }),
    ]);
    expect(Date.parse(importLog()[0].ts as string)).not.toBeNaN();
    expect(prompts).toEqual([]);
  });

  test("an archive without a manifest names no source machine", async () => {
    const zipPath = archive(resolve(elsewhere(), "in.zip"), { "telos/A.md": "a" });
    await cli(importState, [zipPath]);
    expect(output()).not.toContain("Source machine");
    expect(importLog()[0].sourceMachineId).toBeNull();
  });

  test("keeps a diverged local file, quarantines the incoming copy and lists it", async () => {
    writeAt(home, "telos/GOALS.md", "local");
    writeAt(home, "memory/log.jsonl", '{"a":1}\n');
    writeAt(home, "memory/same.md", "same");
    const zipPath = archive(resolve(elsewhere(), "in.zip"), {
      "telos/GOALS.md": "incoming",
      "memory/log.jsonl": '{"a":1}\n{"b":2}\n',
      "memory/same.md": "same",
    });
    await cli(importState, [zipPath]);

    expect(readFileSync(resolve(home, "telos/GOALS.md"), "utf-8")).toBe("local");
    const [entry] = importLog();
    const quarantine = entry.quarantineDir as string;
    expect(quarantine).toMatch(
      new RegExp(`^${resolve(home, "backups")}/import-conflicts-\\d{14}$`)
    );
    expect(readFileSync(resolve(quarantine, "telos/GOALS.md"), "utf-8")).toBe("incoming");
    expect(entry).toMatchObject({ merged: 1, identical: 1, conflicts: 1, linesAdded: 1 });
    expect(output()).toContain(
      `1 file(s) diverged — local kept, incoming saved to ${quarantine}`
    );
    expect(printed).toContain("  telos/GOALS.md");
  });

  test("a dry run lists the entries it would merge and writes nothing", async () => {
    const zipPath = archive(resolve(elsewhere(), "in.zip"), {
      "telos/A.md": "a",
      "memory/B.md": "b",
    });
    await cli(importState, ["--dry-run", zipPath]);
    expect(printed[0]).toBe(`Would merge 2 files → ${home}\n`);
    expect(printed.slice(1).sort()).toEqual(["  memory/B.md", "  telos/A.md"]);
    expect(existsSync(resolve(home, "telos/A.md"))).toBe(false);
  });

  test("a dry run with --overwrite says it would overwrite", async () => {
    const zipPath = archive(resolve(elsewhere(), "in.zip"), { "telos/A.md": "a" });
    await cli(importState, [zipPath, "--overwrite", "--dry-run"]);
    expect(printed[0]).toBe(`Would overwrite with 1 files → ${home}\n`);
    expect(existsSync(resolve(home, "telos/A.md"))).toBe(false);
  });

  test("--overwrite replaces local files and logs an overwrite import", async () => {
    writeAt(home, "telos/A.md", "local");
    const zipPath = archive(resolve(elsewhere(), "in.zip"), {
      "telos/A.md": "incoming",
      "memory/B.md": "b",
    });
    await cli(importState, ["--overwrite", zipPath]);

    expect(readFileSync(resolve(home, "telos/A.md"), "utf-8")).toBe("incoming");
    expect(output()).toContain(`Imported 2 files → ${home} (overwrite)`);
    expect(output()).toContain("Run 'pal cli install' to re-register hooks.");
    expect(importLog()).toEqual([
      expect.objectContaining({
        archive: zipPath,
        mode: "overwrite",
        created: 0,
        merged: 0,
        identical: 0,
        conflicts: 0,
        skipped: 0,
        linesAdded: 0,
        quarantineDir: null,
      }),
    ]);
    expect(Date.parse(importLog()[0].ts as string)).not.toBeNaN();
  });

  test("an empty archive stops cleanly", async () => {
    const zipPath = archive(resolve(elsewhere(), "empty.zip"), {});
    await expect(cli(importState, [zipPath])).rejects.toEqual(new Exited(0));
    expect(printed).toEqual(["Archive is empty."]);
  });
});

describe("importState picking the newest archive", () => {
  test("asks before importing the newest export or backup in PAL_HOME and its backups", async () => {
    archive(resolve(home, "pal-export-old.zip"), { "telos/OLD.md": "old" }, 300);
    const newest = archive(resolve(home, "backups", "pal-backup-new.zip"), {
      "telos/NEW.md": "new",
      "memory/X.md": "x",
    });
    archive(resolve(home, "unrelated.zip"), { "telos/U.md": "u" }, -300);
    writeAt(home, "pal-export-notes.txt", "not an archive");
    await cli(importState, [], " Y ");

    expect(printed[0]).toBe(`Found: ${newest}`);
    expect(printed[1]).toMatch(
      /^Contains 2 files, created \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
    );
    expect(prompts).toEqual(["Import this file? [y/N] "]);
    expect(closedPrompts).toBe(1);
    expect(existsSync(resolve(home, "telos/NEW.md"))).toBe(true);
    expect(existsSync(resolve(home, "telos/OLD.md"))).toBe(false);
    expect(importLog()[0].archive).toBe(newest);
  });

  test("a folder argument searches only that folder", async () => {
    archive(resolve(home, "pal-export-home.zip"), { "telos/HOME.md": "h" }, -300);
    const folder = elsewhere();
    const picked = archive(resolve(folder, "pal-export-there.zip"), {
      "telos/T.md": "t",
    });
    await cli(importState, [folder]);
    expect(printed[0]).toBe(`Found: ${picked}`);
    expect(existsSync(resolve(home, "telos/T.md"))).toBe(true);
  });

  test("anything but yes cancels without importing", async () => {
    archive(resolve(home, "pal-export-a.zip"), { "telos/A.md": "a" });
    await expect(cli(importState, [], "n")).rejects.toEqual(new Exited(0));
    expect(printed).toContain("Cancelled.");
    expect(existsSync(resolve(home, "telos/A.md"))).toBe(false);
  });

  test("with no archive anywhere it fails and asks for a path", async () => {
    await expect(cli(importState, [])).rejects.toEqual(new Exited(1));
    expect(output()).toContain(
      "No export or backup files found. Provide a path: pal cli import <path>"
    );
    expect(prompts).toEqual([]);
  });
});
