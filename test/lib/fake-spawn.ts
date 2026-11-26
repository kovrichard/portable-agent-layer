import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { freshTestDir } from "./test-home";

export interface FakeRun {
  code?: number | null;
  stdout?: string;
  stderr?: string;
  hang?: boolean;
  spawnThrows?: boolean;
  killThrows?: boolean;
  stdin?: "number" | "throws";
  pipes?: "missing" | "number" | "broken";
  onSpawn?: (argv: string[], options: Record<string, unknown>) => void;
}

export interface SpawnCall {
  argv: string[];
  options: Record<string, unknown>;
  writes: string[];
  ended: boolean;
  killed: boolean;
}

function closablePipe(): { stream: ReadableStream<Uint8Array>; close: () => void } {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  return { stream, close: () => controller?.close() };
}

function brokenPipe(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.error(new Error("pipe broke"));
    },
  });
}

const UNREADABLE_PIPES = {
  missing: () => undefined,
  number: () => 1,
  broken: brokenPipe,
};

function pipeFor(run: FakeRun, text: string, hung: (() => void)[]): unknown {
  if (run.pipes) return UNREADABLE_PIPES[run.pipes]();

  if (!run.hang) return new Response(text).body;
  const pipe = closablePipe();
  hung.push(pipe.close);

  return pipe.stream;
}

function stdinFor(run: FakeRun, call: SpawnCall): unknown {
  if (run.stdin === "number") return 3;

  return {
    write: (s: string) => {
      if (run.stdin === "throws") throw new Error("stdin closed");
      call.writes.push(s);
    },
    end: () => {
      call.ended = true;
    },
  };
}

function fakeProc(run: FakeRun, call: SpawnCall) {
  const hung: (() => void)[] = [];
  let exit: (code: number | null) => void = () => {};
  const proc = {
    exitCode: null as number | null,
    exited: new Promise<number | null>((r) => {
      exit = (code) => {
        proc.exitCode = code;
        r(code);
      };
    }),
    stdin: stdinFor(run, call),
    stdout: pipeFor(run, run.stdout ?? "", hung),
    stderr: pipeFor(run, run.stderr ?? "", hung),
    kill: () => {
      call.killed = true;
      hung.forEach((close) => {
        close();
      });
      exit(143);

      if (run.killThrows) throw new Error("already gone");
    },
  };

  if (!run.hang) exit(run.code === undefined ? 0 : run.code);

  return proc;
}

/** Runs `body` with Bun.spawn scripted; the last run repeats once the script is used up. */
export async function withFakeSpawn<T>(
  runs: FakeRun[],
  body: () => Promise<T>
): Promise<{ value: T; calls: SpawnCall[] }> {
  const real = Bun.spawn;
  const calls: SpawnCall[] = [];
  const spawn = (argv: string[], options: Record<string, unknown>) => {
    const run = runs[Math.min(calls.length, runs.length - 1)];
    const call: SpawnCall = { argv, options, writes: [], ended: false, killed: false };
    calls.push(call);
    run.onSpawn?.(argv, options);

    if (run.spawnThrows) throw new Error("ENOENT: no such binary");

    return fakeProc(run, call);
  };
  Bun.spawn = spawn as unknown as typeof Bun.spawn;

  try {
    return { value: await body(), calls };
  } finally {
    Bun.spawn = real;
  }
}

/** A fresh PAL_HOME with debug logging on, and a reader for its debug.log. */
export function debugHome(file: string): { home: string; log: () => string } {
  const home = freshTestDir(file);
  mkdirSync(resolve(home, "memory", "state"), { recursive: true });
  writeFileSync(resolve(home, "memory", "state", "debug-enabled"), "");
  process.env.PAL_HOME = home;
  const path = resolve(home, "debug", "debug.log");

  return { home, log: () => (existsSync(path) ? readFileSync(path, "utf-8") : "") };
}
