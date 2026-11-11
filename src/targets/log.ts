import { createStyle, PALETTE, type Rgb } from "../cli/ui/style";

function runningUnderTest(): boolean {
  return process.env.PAL_TEST_SANDBOX === "1";
}

let narrating = true;

/** Install's step log is for --verbose; the doctor report that follows carries the result. */
export function narrateSteps(on: boolean): void {
  narrating = on;
}

function narrate(line: string): void {
  if (narrating) console.log(line);
}

export type LogLevel = "info" | "success" | "warn" | "error" | "detail";
type LogSink = (level: LogLevel, message: string) => void;

let sink: LogSink | null = null;

/** Hands every log line to `collect` while `work` runs, so a caller can place it under its own step. */
export async function capturingLog<T>(
  collect: LogSink,
  work: () => Promise<T>
): Promise<T> {
  const previous = sink;
  sink = collect;
  try {
    return await work();
  } finally {
    sink = previous;
  }
}

const LEVEL_COLOR: Record<LogLevel, Rgb> = {
  info: PALETTE.indigo,
  success: PALETTE.green,
  warn: PALETTE.amber,
  error: PALETTE.rose,
  detail: PALETTE.indigo,
};

function tagged(level: LogLevel, message: string): string {
  return `${createStyle().paint(LEVEL_COLOR[level], "[pal]")} ${message}`;
}

function emit(level: LogLevel, message: string, write: (line: string) => void): void {
  if (sink) sink(level, message);
  else write(tagged(level, message));
}

export const log = {
  info: (msg: string) => emit("info", msg, narrate),
  success: (msg: string) => emit("success", msg, narrate),
  warn: (msg: string) => emit("warn", msg, (line) => console.log(line)),
  error: (msg: string) => emit("error", msg, (line) => console.error(line)),

  /**
   * Per-item narration from inside a loop, where the caller already reports the
   * total. Silent under the test runner: the suite drives these installers by
   * the hundred against temp directories, so the lines name files that were
   * never on this machine — and they are the only output no caller asserts on,
   * precisely because the summary is what carries the result.
   */
  detail: (msg: string) => {
    if (runningUnderTest()) return;
    emit("detail", msg, narrate);
  },
};
