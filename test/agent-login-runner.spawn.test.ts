import { describe, expect, test } from "bun:test";
import { systemRunner } from "../src/hooks/lib/agent-login";

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
});
