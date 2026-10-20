import { spawnSync } from "node:child_process";
import { appendEvent, isMain, printJson, readRepoConfig } from "./lib.mjs";

const OUTPUT_TAIL = 4000;

export function runCheck(command, cwd, env = process.env) {
  const result = spawnSync("bash", ["-c", command], {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

export function runGate(
  repo,
  context,
  { run = runCheck, config = readRepoConfig(repo), env = process.env } = {}
) {
  const checks = config.gate.map(({ name, run: command }) => {
    const { exitCode, output } = run(command, repo, env);
    appendEvent(
      {
        event: "gate_check",
        ...context,
        check: name,
        result: exitCode === 0 ? "pass" : "fail",
      },
      env
    );
    return { name, exitCode, output: output.slice(-OUTPUT_TAIL) };
  });
  const failed = checks.filter((check) => check.exitCode !== 0);
  appendEvent(
    {
      event: "gate",
      ...context,
      result: failed.length ? "fail" : "pass",
      failed: failed.map((check) => check.name),
    },
    env
  );
  return { passed: failed.length === 0, failed };
}

function contextFromArgs([repo, task, role, attempt, model]) {
  return { repo, context: { task, role, attempt: Number(attempt), model } };
}

if (isMain(import.meta.url)) {
  const { repo, context } = contextFromArgs(process.argv.slice(2));
  const result = runGate(repo, context);
  printJson(result);
  process.exit(result.passed ? 0 : 1);
}
