import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AgentName, DoctorResult } from "../src/cli/doctor/agents";
import { doctorReport } from "../src/cli/doctor/run";
import { AGENT_NAMES } from "../src/core/agent-registry";
import { healthFile } from "../src/hooks/lib/health-cache";
import { loginCacheFile } from "../src/inference/login-cache";
import { debugHome } from "./lib/fake-spawn";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

let home = { home: "", log: () => "" };

beforeEach(() => {
  home = debugHome(import.meta.file);
});

function noAgents(): DoctorResult {
  const agents = Object.fromEntries(
    AGENT_NAMES.map((name) => [name, { name, available: false }])
  ) as Record<AgentName, { name: string; available: boolean }>;

  return {
    ...agents,
    bun: { name: "bun", available: true },
    rtk: { name: "rtk", available: true },
    hasAgent: false,
  };
}

function expiredLogin(): void {
  writeFileSync(
    loginCacheFile(),
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      expiresAtEpoch: Math.floor(Date.now() / 1000) - 60,
    }),
    "utf-8"
  );
}

describe("a doctor report", () => {
  test("writes cache/health.json from its own findings", () => {
    expiredLogin();
    const report = doctorReport(noAgents());
    const saved = JSON.parse(readFileSync(healthFile(), "utf-8"));
    const count = (severity: string) =>
      report.findings.filter((finding) => finding.severity === severity).length;

    expect(saved.failing).toBe(count("fail"));
    expect(saved.warnings).toBe(count("warn"));
    expect(Date.parse(saved.checkedAt)).toBeLessThanOrEqual(Date.now());
  });

  test("lists the login expiry with the inference findings", () => {
    expiredLogin();
    const expiry = doctorReport(noAgents()).findings.find(
      (finding) => finding.id === "claude-login.expiry"
    );

    expect(expiry).toMatchObject({ severity: "fail", group: "Inference" });
  });

  test("still comes back when the summary cannot be written", () => {
    mkdirSync(healthFile(), { recursive: true });
    const report = doctorReport(noAgents());

    expect(report.findings.length).toBeGreaterThan(0);
    expect(home.log()).toContain("doctor:health-summary");
  });
});
