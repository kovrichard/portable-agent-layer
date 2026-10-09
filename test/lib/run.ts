export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  input?: string;
  timeout?: number;
}

/** Runs a command to completion and returns its exit status and text output. */
export function runSync(command: string[], options: RunOptions = {}): RunResult {
  const result = Bun.spawnSync(command, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdin: options.input === undefined ? "ignore" : Buffer.from(options.input),
    timeout: options.timeout,
  });
  return {
    status: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}
