import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cmdIngest } from "../src/cli/knowledge-ingest";
import { exists } from "../src/tools/knowledge/lib";
import { UsageError } from "../src/tools/lib/command";
import { captureConsole } from "./lib/console-capture";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const HOME = testHome(import.meta.file);
const originalIsTTY = process.stdin.isTTY;
const UNREAD_TERMINAL_INPUT = JSON.stringify({ people: [{ name: "Typed Ahead" }] });

function setTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

async function ingest(
  piped: string | null,
  file?: string
): Promise<{ code: number; log: string[]; error: string[] }> {
  setTTY(piped === null);
  const stdin = spyOn(Bun.stdin, "text").mockImplementation(
    async () => piped ?? UNREAD_TERMINAL_INPUT
  );
  const output = captureConsole();

  try {
    const code = await cmdIngest("test-src", file);

    return { code, log: output.log, error: output.error };
  } finally {
    output.restore();
    stdin.mockRestore();
  }
}

function payloadFile(payload: unknown): string {
  const file = resolve(HOME, "payload.json");
  writeFileSync(file, JSON.stringify(payload));

  return file;
}

beforeEach(() => {
  setTTY(originalIsTTY);
  process.env.PAL_HOME = HOME;
  removeOnceReleased(HOME);
  mkdirSync(HOME, { recursive: true });
});

describe("cmdIngest", () => {
  test.each([null, "   "])("with nothing piped (%p) asks for input", async (piped) => {
    const failure = await ingest(piped).then(
      () => null,
      (err: unknown) => err
    );

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as Error).message).toBe(
      "pipe the JSON on stdin or pass --file <path>"
    );
  });

  test("reads people alone from stdin", async () => {
    const { code, log } = await ingest(
      JSON.stringify({ people: [{ name: "Ida Example" }] })
    );

    expect(code).toBe(0);
    expect(JSON.parse(log[0])).toEqual({
      source: "test-src",
      people: { total: 1, created: 1, updated: 0, slugs: ["ida-example"] },
      companies: { total: 0, created: 0, updated: 0, slugs: [] },
    });
  });

  test("a file wins over stdin, and a second run counts updates", async () => {
    const piped = JSON.stringify({ people: [{ name: "Not Read" }] });
    const file = payloadFile({ companies: [{ name: "Kappa Ltd" }] });
    await ingest(piped, file);
    const { log } = await ingest(piped, file);

    expect(exists("People", "not-read")).toBe(false);
    expect(JSON.parse(log[0])).toEqual({
      source: "test-src",
      people: { total: 0, created: 0, updated: 0, slugs: [] },
      companies: { total: 1, created: 0, updated: 1, slugs: ["kappa-ltd"] },
    });
  });

  test("counts created and updated people and companies apart", async () => {
    const people = [{ name: "Ida Example" }, { name: "Jon Example" }];
    await ingest(null, payloadFile({ people }));
    const { log } = await ingest(
      null,
      payloadFile({
        people: [...people, { name: "Kim Example" }],
        companies: [{ name: "Kappa Ltd" }, { name: "Lambda Ltd" }],
      })
    );

    expect(JSON.parse(log[0])).toMatchObject({
      people: { total: 3, created: 1, updated: 2 },
      companies: { total: 2, created: 2, updated: 0 },
    });
  });

  test("refuses JSON with neither list", async () => {
    const { code, error } = await ingest(JSON.stringify({ people: "nobody" }));

    expect(code).toBe(1);
    expect(error).toEqual([
      'Error: JSON must include at least one of "people" or "companies" arrays.',
    ]);
  });
});
