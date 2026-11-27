import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { systemRunner } from "../src/inference/agent-login";
import { freshTestDir } from "./lib/test-home";

const bun = process.execPath;

describe("the runner that asks the agent", () => {
  test("returns the exit code and stdout", () => {
    expect(systemRunner([bun, "-e", "console.log('{}'); process.exit(3)"], 5000)).toEqual(
      { code: 3, stdout: "{}\n", timedOut: false }
    );
  });

  test("stops a command that outlives its timeout", () => {
    const result = systemRunner([bun, "-e", "await Bun.sleep(5000)"], 200);

    expect(result.timedOut).toBe(true);
    expect(result.code).not.toBe(0);
  });

  test("passes the token from PAL's .env, as inference does", () => {
    const home = freshTestDir(import.meta.file);
    writeFileSync(resolve(home, ".env"), "CLAUDE_CODE_OAUTH_TOKEN=from-pal-env\n");
    process.env.PAL_HOME = home;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const printToken = "console.log(process.env.CLAUDE_CODE_OAUTH_TOKEN ?? 'none')";

    expect(systemRunner([bun, "-e", printToken], 5000).stdout).toBe("from-pal-env\n");
  });
});
