/**
 * How long a hook and each of its handlers took, logged as one event per run.
 */

import { appendEvent, logQuietly } from "./events";

function elapsedMs(since: number): number {
  return Math.round((performance.now() - since) * 10) / 10;
}

export function startHookTiming(hook: string) {
  const started = performance.now();
  const handlers: Record<string, number> = {};
  return {
    async time<T>(name: string, work: Promise<T> | (() => Promise<T> | T)): Promise<T> {
      const begun = performance.now();
      try {
        return await (typeof work === "function" ? work() : work);
      } finally {
        handlers[name] = elapsedMs(begun);
      }
    },
    log(session: string | null | undefined): void {
      logQuietly("hook_timing", () =>
        appendEvent(
          "hook_timing",
          { hook, totalMs: elapsedMs(started), handlers },
          { session: session ?? null }
        )
      );
    },
  };
}
