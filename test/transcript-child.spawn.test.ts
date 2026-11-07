import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assets } from "../src/hooks/lib/paths";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const CHILDREN = ["session-intelligence", "entity-extraction"] as const;

let HOME: string;
let handoff: string;

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  handoff = resolve(HOME, "memory", "state", "transcript-handoff");
  mkdirSync(handoff, { recursive: true });
});

function transcriptFile(): string {
  const messages = Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i} `.repeat(50),
  }));
  const file = resolve(handoff, `${crypto.randomUUID()}.txt`);
  writeFileSync(file, JSON.stringify(messages), "utf-8");
  return file;
}

async function runChild(name: string, file: string, home: string): Promise<number> {
  const script = resolve(assets.hooks(), "handlers", `${name}.ts`);
  const proc = Bun.spawn(["bun", script, "--run", "child-sid", file], {
    env: { ...process.env, PAL_HOME: home, PAL_INFERENCE_DISABLED: "1" },
    stdio: ["ignore", "ignore", "ignore"],
  });
  return proc.exited;
}

describe.each(CHILDREN)("%s child", (name) => {
  test("deletes the hand-off file after a successful run", async () => {
    const file = transcriptFile();
    expect(await runChild(name, file, HOME)).toBe(0);
    expect(existsSync(file)).toBe(false);
  });

  test("deletes the hand-off file when its work throws", async () => {
    const brokenHome = freshTestDir(import.meta.file);
    mkdirSync(resolve(brokenHome, "memory"), { recursive: true });
    writeFileSync(resolve(brokenHome, "memory", "state"), "a file, not a folder");
    const file = resolve(brokenHome, `${crypto.randomUUID()}.txt`);
    writeFileSync(file, "{not json", "utf-8");

    await runChild(name, file, brokenHome);

    expect(existsSync(file)).toBe(false);
  });
});
