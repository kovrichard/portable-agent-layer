import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";

const QUIET_LIMIT_MS = Number(process.env.DIAG_QUIET_MS ?? 60_000);
const SECOND_LOOK_MS = Number(process.env.DIAG_SECOND_LOOK_MS ?? 30_000);

const seed = Math.floor(Math.random() * 2 ** 31);
process.stderr.write(`[diag] bun test --randomize --isolate --seed=${seed}\n`);

const suite = Bun.spawn(["bun", "test", "--randomize", "--isolate", `--seed=${seed}`], {
  stdout: "pipe",
  stderr: "pipe",
  stdin: "ignore",
});

let lastOutput = Date.now();

async function relay(stream: ReadableStream<Uint8Array>, fd: 1 | 2): Promise<void> {
  for await (const chunk of stream) {
    lastOutput = Date.now();
    (fd === 1 ? process.stdout : process.stderr).write(chunk);
  }
}

function sh(command: string[]): string {
  const r = spawnSync(command[0], command.slice(1), { encoding: "utf8" });
  return r.stdout || r.stderr || "";
}

function descendants(root: number): number[] {
  const rows = sh(["ps", "-eo", "pid=,ppid="])
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const found = [root];
  for (let i = 0; i < found.length; i++) {
    for (const [pid, ppid] of rows) if (ppid === found[i]) found.push(pid);
  }
  return found;
}

function procDetail(pid: number): string {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8")
      .split("\n")
      .filter((l) => /^(Name|State|PPid|Threads):/.test(l))
      .join(" | ");
    const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
    const wchan = readFileSync(`/proc/${pid}/wchan`, "utf8");
    const fds = readdirSync(`/proc/${pid}/fd`)
      .map((fd) => {
        try {
          return `${fd}->${readlinkSync(`/proc/${pid}/fd/${fd}`)}`;
        } catch {
          return `${fd}->?`;
        }
      })
      .join(" ");
    return `pid ${pid}: ${status} | wchan=${wchan}\n  cmd: ${cmd}\n  fds: ${fds}`;
  } catch (error) {
    return `pid ${pid}: gone (${(error as Error).message})`;
  }
}

function dump(label: string): void {
  process.stderr.write(`\n[diag] ===== ${label} — seed ${seed} =====\n`);
  if (process.platform !== "linux") {
    process.stderr.write(sh(["ps", "-eo", "pid,ppid,etime,stat,args"]));
    return;
  }
  process.stderr.write(
    sh(["ps", "-eo", "pid,ppid,pgid,etimes,stat,wchan:24,args", "--forest"])
  );
  for (const pid of descendants(suite.pid)) process.stderr.write(`${procDetail(pid)}\n`);
}

const watchdog = setInterval(async () => {
  if (Date.now() - lastOutput < QUIET_LIMIT_MS) return;
  clearInterval(watchdog);
  dump(`no output for ${QUIET_LIMIT_MS / 1000}s`);
  await Bun.sleep(SECOND_LOOK_MS);
  dump(`${SECOND_LOOK_MS / 1000}s later`);
  suite.kill("SIGKILL");
  process.exit(1);
}, 5_000);

await Promise.all([relay(suite.stdout, 1), relay(suite.stderr, 2)]);
const code = await suite.exited;
clearInterval(watchdog);
process.exit(code);
