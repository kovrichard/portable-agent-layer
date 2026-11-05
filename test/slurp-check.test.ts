import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { eventsSince } from "../src/hooks/lib/events";
import { reload } from "../src/hooks/lib/settings";
import {
  NOTEWORTHY_BYTES,
  recordSlurpCheck,
  showsOutOfMemory,
  slurpVerdictOf,
} from "../src/hooks/lib/slurp-check";
import {
  commandSlurps,
  type FileProbe,
  shellTokens,
} from "../src/hooks/lib/slurp-detect";
import { freshTestDir } from "./lib/test-home";

const CWD = resolve("/work");
const BIG = resolve(CWD, "big.json");
const SMALL = resolve(CWD, "small.json");
const GB = 1024 ** 3;

function fakeDisk(files: Record<string, number | string>): FileProbe {
  return {
    sizeOf: (path) => {
      const entry = files[path];
      if (entry === undefined) return null;
      return typeof entry === "number" ? entry : entry.length;
    },
    readScript: (path) => {
      const entry = files[path];
      return typeof entry === "string" ? entry : null;
    },
  };
}

const disk = fakeDisk({ [BIG]: 6 * GB, [SMALL]: 10 });

function bash(command: string, extra: Record<string, unknown> = {}) {
  return { tool_name: "Bash", tool_input: { command }, ...extra };
}

describe("shell tokens", () => {
  test("keeps a quoted jq filter with a pipe in it as one word", () => {
    expect(shellTokens(`jq '.a | .b' big.json | head`)).toEqual([
      "jq",
      ".a | .b",
      "big.json",
      "|",
      "head",
    ]);
  });

  test("does not split a stderr redirect into a background operator", () => {
    expect(shellTokens("jq . big.json 2>&1")).not.toContain("&");
  });
});

describe("commandSlurps on shell commands", () => {
  test("jq with a file argument loads that file", () => {
    expect(commandSlurps("jq '.items[]' big.json", CWD, disk)).toEqual([
      { path: BIG, idiom: "jq", bytes: 6 * GB },
    ]);
  });

  test("jq -s is reported as a slurp, also inside combined short flags", () => {
    expect(commandSlurps("jq -cs . big.json", CWD, disk)[0]?.idiom).toBe("jq -s");
  });

  test("jq --stream reads in pieces, so it is not a slurp", () => {
    expect(commandSlurps("jq --stream . big.json", CWD, disk)).toEqual([]);
  });

  test("jq fed by cat or a redirect loads the file on stdin", () => {
    expect(commandSlurps("cat big.json | jq .", CWD, disk)[0]?.path).toBe(BIG);
    expect(commandSlurps("jq . < big.json", CWD, disk)[0]?.path).toBe(BIG);
  });

  test("jq --slurpfile loads its side file whole", () => {
    const hits = commandSlurps("jq -n --slurpfile d big.json '$d'", CWD, disk);
    expect(hits.map((h) => h.idiom)).toEqual(["jq --slurpfile"]);
  });

  test("an arg or argjson value is not mistaken for a file", () => {
    expect(commandSlurps("jq --arg x big.json '.a' small.json", CWD, disk)).toEqual([
      { path: SMALL, idiom: "jq", bytes: 10 },
    ]);
  });

  test("sort spills to disk, so it is never reported", () => {
    expect(commandSlurps("sort big.json | uniq -c", CWD, disk)).toEqual([]);
  });

  test("command substitution of cat loads the file into a shell variable", () => {
    expect(commandSlurps('data="$(cat big.json)"', CWD, disk)[0]?.idiom).toBe("$(cat)");
  });

  test("a path that does not exist is dropped", () => {
    expect(commandSlurps("jq . missing.json", CWD, disk)).toEqual([]);
  });
});

describe("commandSlurps on inline and script code", () => {
  test("readFileSync in bun -e", () => {
    const hits = commandSlurps(`bun -e 'readFileSync("big.json","utf8")'`, CWD, disk);
    expect(hits[0]?.idiom).toBe("readFileSync");
  });

  test("Bun.file().text() but not Bun.file().stream()", () => {
    expect(
      commandSlurps(`bun -e 'await Bun.file("big.json").text()'`, CWD, disk)
    ).toHaveLength(1);
    expect(commandSlurps(`bun -e 'Bun.file("big.json").stream()'`, CWD, disk)).toEqual(
      []
    );
  });

  test("python with-open read, but not a line-by-line loop", () => {
    const slurp = `python3 - <<'EOF'\nwith open("big.json") as f:\n    data = f.read()\nEOF`;
    const loop = `python3 - <<'EOF'\nwith open("big.json") as f:\n    for line in f: pass\nEOF`;
    expect(commandSlurps(slurp, CWD, disk)[0]?.idiom).toBe("with open().read");
    expect(commandSlurps(loop, CWD, disk)).toEqual([]);
  });

  test("pandas read_csv without chunksize, not with it", () => {
    expect(commandSlurps(`python3 -c 'pd.read_csv("big.json")'`, CWD, disk)).toHaveLength(
      1
    );
    expect(
      commandSlurps(`python3 -c 'pd.read_csv("big.json", chunksize=1000)'`, CWD, disk)
    ).toEqual([]);
  });

  test("reads the script a command runs and finds its slurp", () => {
    const withScript = fakeDisk({
      [BIG]: 6 * GB,
      [resolve(CWD, "load.py")]: 'import json\nrows = json.load(open("big.json"))\n',
    });
    expect(commandSlurps("python3 load.py", CWD, withScript)[0]).toEqual({
      path: BIG,
      idiom: "json.load",
      bytes: 6 * GB,
    });
  });
});

describe("the shadow verdict", () => {
  test("predicts a risk above the threshold and reports no OOM on a clean run", () => {
    const verdict = slurpVerdictOf(bash("jq . big.json"), CWD, disk, 2 * GB);
    expect(verdict).toMatchObject({ predicted: true, oom: false });
  });

  test("small files are below the noteworthy floor and leave no verdict", () => {
    expect(disk.sizeOf(SMALL)).toBeLessThan(NOTEWORTHY_BYTES);
    expect(slurpVerdictOf(bash("jq . small.json"), CWD, disk, 2 * GB)).toBeNull();
  });

  test("an OOM kill is recorded even when nothing was predicted", () => {
    const killed = bash("python3 build.py", { error: "Exit code 137\nKilled" });
    expect(slurpVerdictOf(killed, CWD, disk, 2 * GB)).toMatchObject({
      predicted: false,
      oom: true,
      hits: [],
    });
  });

  test("a denied call never ran, so it leaves no verdict", () => {
    const denied = bash("jq . big.json", { hook_event_name: "PermissionDenied" });
    expect(slurpVerdictOf(denied, CWD, disk, 2 * GB)).toBeNull();
  });

  test("recognises how runtimes report running out of memory", () => {
    for (const error of [
      "Killed: 9",
      "MemoryError",
      "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
      "RangeError: Out of memory",
    ]) {
      expect(showsOutOfMemory({ error })).toBe(true);
    }
    expect(showsOutOfMemory({ exit_code: 137 })).toBe(true);
    expect(showsOutOfMemory({ error: "Exit code 1" })).toBe(false);
  });
});

describe("recordSlurpCheck", () => {
  let home: string;

  beforeEach(() => {
    home = freshTestDir(import.meta.file);
    process.env.PAL_HOME = home;
    process.env.PAL_AGENT = "claude";
    mkdirSync(resolve(home, "memory"), { recursive: true });
    writeFileSync(resolve(home, "memory", "pal-settings.json"), "{}");
    reload();
  });

  test("writes a shadow slurp_check event for an OOM-killed command", () => {
    const since = new Date(Date.now() - 1000);
    recordSlurpCheck(bash("python3 build.py", { error: "Exit code 137" }), home);
    const [event] = eventsSince("slurp_check", since);
    expect(event).toMatchObject({ type: "slurp_check", mode: "shadow", oom: true });
  });

  test("writes nothing for an ordinary command", () => {
    const since = new Date(Date.now() - 1000);
    recordSlurpCheck(bash("ls -la"), home);
    expect(eventsSince("slurp_check", since)).toEqual([]);
  });
});
