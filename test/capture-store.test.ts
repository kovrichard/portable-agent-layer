import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  type CaptureEntry,
  capturedPath,
  isRecaptureWorthwhile,
  learningSlug,
  markCaptured,
  readCapture,
} from "../src/hooks/lib/capture-store";

// Stop fires after every response, so one session reaches the capture handler
// many times. These cases pin what stops it writing the same learning twice, and
// what happens when the file it reads is older than the shape it expects.

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-capture-"));
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

function writeRaw(content: string): void {
  writeFileSync(capturedPath(), content, "utf-8");
}

function stored(): Record<string, CaptureEntry> {
  return JSON.parse(readFileSync(capturedPath(), "utf-8"));
}

describe("reading what was already captured", () => {
  test("an unseen session has no capture", () => {
    expect(readCapture("s1")).toBeNull();
  });

  test("a missing file is not an error, just nothing captured yet", () => {
    expect(existsSync(capturedPath())).toBe(false);
    expect(readCapture("s1")).toBeNull();
  });

  test("a session reads back what was written for it", () => {
    markCaptured("s1", "/learning/a.md", 12);
    expect(readCapture("s1")).toEqual({ filepath: "/learning/a.md", messageCount: 12 });
  });

  test("one session's capture is not another's", () => {
    markCaptured("s1", "/learning/a.md", 12);
    expect(readCapture("s2")).toBeNull();
  });
});

describe("a file written by an older version", () => {
  test("a bare filepath string still names its file", () => {
    writeRaw(JSON.stringify({ s1: "/learning/old.md" }));
    expect(readCapture("s1")?.filepath).toBe("/learning/old.md");
  });

  test("and counts as zero messages, so the session re-captures rather than being lost", () => {
    writeRaw(JSON.stringify({ s1: "/learning/old.md" }));
    expect(isRecaptureWorthwhile(readCapture("s1"), 10)).toBe(true);
  });

  test("an array — the shape before it was keyed — is discarded, not read positionally", () => {
    writeRaw(JSON.stringify(["/learning/old.md"]));
    expect(readCapture("0")).toBeNull();
  });

  test("unparseable JSON reads as nothing captured", () => {
    writeRaw("{not json");
    expect(readCapture("s1")).toBeNull();
  });

  test("a null entry is dropped, not handed back as a capture", () => {
    writeRaw(JSON.stringify({ s1: null }));
    expect(readCapture("s1")).toBeNull();
  });

  test("an entry that is neither a path nor a record is dropped", () => {
    writeRaw(JSON.stringify({ s1: 42 }));
    expect(readCapture("s1")).toBeNull();
  });

  test("a bare JSON string is not read character by character", () => {
    writeRaw(JSON.stringify("hello"));
    expect(readCapture("0")).toBeNull();
  });

  test("writing over a corrupt file starts it fresh instead of throwing", () => {
    writeRaw("{not json");
    markCaptured("s1", "/learning/a.md", 5);
    expect(stored()).toEqual({ s1: { filepath: "/learning/a.md", messageCount: 5 } });
  });
});

describe("whether a re-capture is worth writing", () => {
  test("a session never captured is always worth writing", () => {
    expect(isRecaptureWorthwhile(null, 6)).toBe(true);
  });

  test("ten new messages is enough", () => {
    expect(isRecaptureWorthwhile({ filepath: "a", messageCount: 5 }, 15)).toBe(true);
  });

  test("nine is not — the window the summary is drawn from has barely moved", () => {
    expect(isRecaptureWorthwhile({ filepath: "a", messageCount: 5 }, 14)).toBe(false);
  });

  test("no new messages at all is not", () => {
    expect(isRecaptureWorthwhile({ filepath: "a", messageCount: 12 }, 12)).toBe(false);
  });

  test("a transcript that shrank is not", () => {
    expect(isRecaptureWorthwhile({ filepath: "a", messageCount: 30 }, 12)).toBe(false);
  });
});

describe("how many sessions the file remembers", () => {
  test("fifty are kept as they are", () => {
    for (let i = 0; i < 50; i++) markCaptured(`s${i}`, `/l/${i}.md`, i);
    expect(Object.keys(stored())).toHaveLength(50);
  });

  test("the fifty-first drops the oldest, not the newest", () => {
    for (let i = 0; i < 51; i++) markCaptured(`s${i}`, `/l/${i}.md`, i);
    const keys = Object.keys(stored());
    expect(keys).toHaveLength(50);
    expect(keys).not.toContain("s0");
    expect(keys).toContain("s50");
  });

  test("re-capturing an existing session updates in place and does not grow the file", () => {
    for (let i = 0; i < 50; i++) markCaptured(`s${i}`, `/l/${i}.md`, i);
    markCaptured("s0", "/l/0-again.md", 99);
    expect(Object.keys(stored())).toHaveLength(50);
    expect(readCapture("s0")).toEqual({ filepath: "/l/0-again.md", messageCount: 99 });
  });
});

describe("the readable half of a learning filename", () => {
  test("is lowercase and dash-joined", () => {
    expect(learningSlug("Fixed The Auth Bug")).toBe("fixed-the-auth-bug");
  });

  test("keeps four words, because the rest of the name is already timestamp and category", () => {
    expect(learningSlug("one two three four five six")).toBe("one-two-three-four");
  });

  test("drops punctuation rather than encoding it into the filename", () => {
    expect(learningSlug("Fixed: the auth/bug!")).toBe("fixed-the-authbug");
  });

  test("collapses runs of whitespace", () => {
    expect(learningSlug("fixed   the    bug")).toBe("fixed-the-bug");
  });

  test("keeps digits, which carry meaning in a version or a ticket", () => {
    expect(learningSlug("upgrade to bun 1.4")).toBe("upgrade-to-bun-14");
  });

  test("a title that is all punctuation reduces to nothing rather than to junk", () => {
    expect(learningSlug("!!! ???")).toBe("");
  });
});
