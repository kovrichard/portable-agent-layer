import { beforeAll, expect } from "bun:test";

const PAGE_BUILD_TIMEOUT_MS = 60_000;

async function ensurePageBuilt(): Promise<void> {
  const { buildPage, isBuilt } = await import("../../src/tools/control-room/static");
  if (!isBuilt()) expect(buildPage()).toBe(true);
}

/**
 * The control room's page is a build artifact, not source — ui/dist is
 * gitignored, so a fresh clone and every CI run start without it. Any suite
 * that asserts on a page route has to say so out loud rather than inherit a
 * dist some earlier run happened to leave behind. A cold vite build outlasts
 * Bun's five-second hook default on a Windows runner.
 */
export function buildPageFirst(): void {
  beforeAll(ensurePageBuilt, PAGE_BUILD_TIMEOUT_MS);
}
