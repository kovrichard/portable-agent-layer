import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { telemetryCommand } from "../src/cli/telemetry";
import { raw, reload, write } from "../src/hooks/lib/settings";
import {
  heartbeatDue,
  heartbeatEndpoint,
  optOutReason,
  sendHeartbeat,
  telemetryState,
} from "../src/hooks/lib/telemetry";
import { runCommand } from "../src/tools/lib/command";
import { freshTestDir } from "./lib/test-home";

const URL = "http://heartbeat.invalid/beat";
const ON = { PAL_TELEMETRY_URL: URL };
const NO_ENDPOINT = { PAL_TELEMETRY_URL: "" };
const DAY_MS = 24 * 60 * 60 * 1000;

let home: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  mkdirSync(resolve(home, "memory"), { recursive: true });
  process.env.PAL_HOME = home;
  reload();
});

function heartbeatEvents(): Record<string, unknown>[] {
  const file = resolve(
    home,
    "memory",
    "events",
    `${new Date().toISOString().slice(0, 7)}.jsonl`
  );
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === "pal_heartbeat");
}

function recordingFetch(status = 204) {
  const bodies: unknown[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

const failingFetch = (async () => {
  throw new Error("offline");
}) as unknown as typeof fetch;

async function telemetry(...args: string[]): Promise<string> {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((line) =>
    lines.push(String(line))
  );
  try {
    await runCommand(telemetryCommand, args, ["pal", "cli", "telemetry"]);
  } finally {
    log.mockRestore();
  }
  return lines.join("\n");
}

describe("what turns the heartbeat off", () => {
  test("nothing, on a plain install", () => {
    expect(optOutReason({})).toBeNull();
  });

  test.each([
    ["DO_NOT_TRACK", "1"],
    ["PAL_TELEMETRY_DISABLED", "1"],
    ["PAL_TEST_SANDBOX", "1"],
    ["CI", "true"],
  ])("%s=%s", (name, value) => {
    expect(optOutReason({ [name]: value })).not.toBeNull();
  });

  test("the setting", () => {
    write({ telemetry: { enabled: false } });
    expect(optOutReason({})).toBe("turned off in settings");
  });
});

describe("what is sent", () => {
  test("exactly the six fields, with the install's own id", async () => {
    const { bodies, fetchImpl } = recordingFetch();
    expect(await sendHeartbeat(["codex", "claude"], { env: ON, fetchImpl })).toBe("sent");
    expect(bodies).toEqual([
      {
        install_id: telemetryState().id,
        version: expect.any(String),
        channel: "stable",
        os: process.platform,
        arch: process.arch,
        agents: ["claude", "codex"],
      },
    ]);
  });

  test("the install id is not the machine id", async () => {
    const { bodies, fetchImpl } = recordingFetch();
    await sendHeartbeat([], { env: ON, fetchImpl });
    const machineFile = resolve(home, "machine.json");
    const machineId = existsSync(machineFile)
      ? JSON.parse(readFileSync(machineFile, "utf-8")).id
      : null;
    expect((bodies[0] as { install_id: string }).install_id).not.toBe(machineId);
  });

  test("the id stays the same from one day to the next", async () => {
    const { bodies, fetchImpl } = recordingFetch();
    await sendHeartbeat([], { env: ON, fetchImpl });
    await sendHeartbeat([], { env: ON, fetchImpl, now: Date.now() + DAY_MS });
    const [first, second] = bodies as { install_id: string }[];
    expect(second.install_id).toBe(first.install_id);
  });
});

describe("the event log holds every attempt", () => {
  test("a send is logged with the payload that went out", async () => {
    const { bodies, fetchImpl } = recordingFetch();
    await sendHeartbeat(["claude"], { env: ON, fetchImpl });
    const [event] = heartbeatEvents();
    expect(event.outcome).toBe("sent");
    expect(event.payload).toEqual(bodies[0]);
    expect(event.status).toBe(204);
  });

  test("a failure is logged as failed", async () => {
    expect(await sendHeartbeat([], { env: ON, fetchImpl: failingFetch })).toBe("failed");
    expect(heartbeatEvents()[0].outcome).toBe("failed");
  });

  test("a refused heartbeat is logged as failed with the status", async () => {
    const { fetchImpl } = recordingFetch(500);
    expect(await sendHeartbeat([], { env: ON, fetchImpl })).toBe("failed");
    expect(heartbeatEvents()[0].status).toBe(500);
  });

  test("an opted-out send sends nothing and logs why", async () => {
    const { bodies, fetchImpl } = recordingFetch();
    await sendHeartbeat([], { env: { ...ON, DO_NOT_TRACK: "1" }, fetchImpl });
    expect(bodies).toEqual([]);
    expect(heartbeatEvents()[0]).toMatchObject({
      outcome: "skipped",
      skipReason: "DO_NOT_TRACK is set",
    });
  });

  test("with no endpoint, nothing is sent", async () => {
    const { bodies, fetchImpl } = recordingFetch();
    expect(await sendHeartbeat([], { env: NO_ENDPOINT, fetchImpl })).toBe("skipped");
    expect(bodies).toEqual([]);
  });
});

describe("once a day", () => {
  test("a fresh install is due", () => {
    expect(heartbeatDue(ON)).toBe(true);
  });

  test("a send holds the next one for a day", async () => {
    const { fetchImpl } = recordingFetch();
    const now = Date.now();
    await sendHeartbeat([], { env: ON, fetchImpl, now });
    expect(heartbeatDue(ON, now + DAY_MS - 1000)).toBe(false);
    expect(heartbeatDue(ON, now + DAY_MS + 1000)).toBe(true);
  });

  test("a failed send also waits until tomorrow", async () => {
    const now = Date.now();
    await sendHeartbeat([], { env: ON, fetchImpl: failingFetch, now });
    expect(heartbeatDue(ON, now + 1000)).toBe(false);
  });

  test("an opted-out install is never due", () => {
    expect(heartbeatDue({ ...ON, DO_NOT_TRACK: "1" })).toBe(false);
  });

  test("nothing is due without an endpoint", () => {
    expect(heartbeatDue(NO_ENDPOINT)).toBe(false);
  });

  test("the built-in endpoint is used when nothing overrides it", () => {
    expect(heartbeatEndpoint({})).toStartWith("https://");
  });
});

describe("pal cli telemetry", () => {
  test("off turns it off and on turns it back on", async () => {
    await telemetry("off");
    expect(raw().telemetry?.enabled).toBe(false);
    await telemetry("on");
    expect(raw().telemetry?.enabled).toBe(true);
  });

  test("status names the install id", async () => {
    expect(await telemetry("status")).toContain(telemetryState().id);
  });

  test("show prints what was sent", async () => {
    const { fetchImpl } = recordingFetch();
    await sendHeartbeat(["claude"], { env: ON, fetchImpl });
    const shown = await telemetry("show");
    expect(shown).toContain("sent");
    expect(shown).toContain(telemetryState().id);
  });
});
