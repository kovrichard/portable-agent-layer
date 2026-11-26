import { spyOn } from "bun:test";

/** Silences console.log and console.error and keeps each call as one joined line. */
export function captureConsole(): {
  log: string[];
  error: string[];
  restore: () => void;
} {
  const log: string[] = [];
  const error: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    log.push(a.join(" "));
  });
  const errorSpy = spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    error.push(a.join(" "));
  });

  return {
    log,
    error,
    restore: () => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}
