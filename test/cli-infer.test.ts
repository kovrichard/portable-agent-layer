import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inferFromCli } from "../src/cli/infer";
import type { inference } from "../src/hooks/lib/inference";
import { freshTestDir } from "./lib/test-home";

type InferenceCall = Parameters<typeof inference>[0];

let dir: string;
let printed: { out: string[]; err: string[] };
let logSpy: ReturnType<typeof spyOn> | undefined;
let errSpy: ReturnType<typeof spyOn> | undefined;

beforeEach(() => {
  logSpy?.mockRestore();
  errSpy?.mockRestore();
  dir = freshTestDir(import.meta.file);
  printed = { out: [], err: [] };
  logSpy = spyOn(console, "log").mockImplementation((...a) =>
    printed.out.push(a.join(" "))
  );
  errSpy = spyOn(console, "error").mockImplementation((...a) =>
    printed.err.push(a.join(" "))
  );
});

function recording(reply: Awaited<ReturnType<typeof inference>>) {
  const calls: InferenceCall[] = [];
  const infer = async (call: InferenceCall) => {
    calls.push(call);
    return reply;
  };
  return { calls, infer };
}

function file(name: string, content: string): string {
  const path = resolve(dir, name);
  writeFileSync(path, content);
  return path;
}

describe("pal cli infer", () => {
  test("prints the reply to the prompt it read from stdin", async () => {
    const { calls, infer } = recording({ success: true, output: "Paris" });

    expect(await inferFromCli({}, "Capital of France?\n", infer)).toBe(0);
    expect(printed.out).toEqual(["Paris"]);
    expect(calls[0].user).toBe("Capital of France?");
  });

  test("runs on the small tier unless a tier is named", async () => {
    const { calls, infer } = recording({ success: true, output: "ok" });

    await inferFromCli({}, "q", infer);
    await inferFromCli({ tier: "medium" }, "q", infer);
    expect(calls.map((c) => c.tier)).toEqual(["small", "medium"]);
  });

  test("passes the system prompt and the JSON schema from their files", async () => {
    const { calls, infer } = recording({ success: true, output: '{"met":true}' });
    const schema = { type: "object", properties: { met: { type: "boolean" } } };
    const values = {
      system: file("system.md", "You check one condition."),
      schema: file("schema.json", JSON.stringify(schema)),
    };

    expect(await inferFromCli(values, "Is it out?", infer)).toBe(0);
    expect(calls[0].system).toBe("You check one condition.");
    expect(calls[0].jsonSchema).toEqual(schema);
    expect(printed.out).toEqual(['{"met":true}']);
  });

  test("names the caller and the timeout it was given", async () => {
    const { calls, infer } = recording({ success: true, output: "ok" });

    await inferFromCli({ caller: "watch-ask", timeout: "90" }, "q", infer);
    expect(calls[0].caller).toBe("watch-ask");
    expect(calls[0].timeout).toBe(90_000);
  });

  test("exits 1 with the route's error when inference fails", async () => {
    const { infer } = recording({ success: false, error: "not logged in" });

    expect(await inferFromCli({}, "q", infer)).toBe(1);
    expect(printed.out).toEqual([]);
    expect(printed.err.join("\n")).toContain("not logged in");
  });

  test("says when a reply did not come back as JSON for a schema", async () => {
    const { infer } = recording({ success: false, output: "Sure! It is out." });
    const values = { schema: file("schema.json", '{"type":"object"}') };

    expect(await inferFromCli(values, "q", infer)).toBe(1);
    expect(printed.err.join("\n")).toContain("not JSON");
  });

  test("refuses an empty prompt, an unknown tier and a bad timeout without inferring", async () => {
    const { calls, infer } = recording({ success: true, output: "ok" });

    expect(await inferFromCli({}, "  \n", infer)).toBe(1);
    expect(await inferFromCli({ tier: "huge" }, "q", infer)).toBe(1);
    expect(await inferFromCli({ timeout: "soon" }, "q", infer)).toBe(1);
    expect(await inferFromCli({ schema: file("bad.json", "{type") }, "q", infer)).toBe(1);
    expect(calls).toEqual([]);
    expect(printed.err.join("\n")).toContain("small, medium");
  });
});
