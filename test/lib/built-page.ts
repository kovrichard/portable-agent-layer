import { expect } from "bun:test";

/**
 * The control room's page is a build artifact, not source — ui/dist is
 * gitignored, so a fresh clone and every CI run start without it. Any suite
 * that asserts on a page route has to say so out loud rather than inherit a
 * dist some earlier run happened to leave behind.
 */
export async function ensurePageBuilt(): Promise<void> {
  const { buildPage, isBuilt } = await import("../../src/tools/control-room/static");
  if (!isBuilt()) expect(buildPage()).toBe(true);
}
