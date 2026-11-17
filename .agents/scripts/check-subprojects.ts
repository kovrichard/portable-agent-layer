import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { git, lockDirs, lockInputsInCheckout, pathsInPorcelain } from "./check-lock";

export const CONFIG_PATH = ".agents/subprojects.json";
const TOOLS_ROOT = resolve(import.meta.dir, "..", "..");
const BUILD_OUTPUT_PATTERN = String.raw`(^|[\\/])(node_modules|\.next|out)[\\/]`;

const projectSettingsSchema = z.strictObject({
  knip: z.record(z.string(), z.unknown()).optional(),
  overlays: z.array(z.string()).optional(),
});
const configSchema = z.record(z.string(), projectSettingsSchema);

type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type SubprojectConfig = z.infer<typeof configSchema>;

export interface GateOptions {
  build: boolean;
  changedOnly: boolean;
}

interface Step {
  name: string;
  command: () => string[];
}

interface Target {
  label: string;
  dir: string;
  steps: Step[];
}

export function subprojectDirs(inputs: string[]): string[] {
  return lockDirs(inputs).filter((dir) => dir !== ".");
}

export function parseSubprojectConfig(
  text: string,
  projects: string[]
): SubprojectConfig {
  const config = configSchema.parse(JSON.parse(text));
  const strays = Object.keys(config).filter((dir) => !projects.includes(dir));
  if (strays.length > 0) {
    throw new Error(
      `${CONFIG_PATH} names folders with no bun.lock: ${strays.join(", ")}`
    );
  }

  return config;
}

function readConfig(root: string, projects: string[]): SubprojectConfig {
  const path = join(root, CONFIG_PATH);

  return existsSync(path)
    ? parseSubprojectConfig(readFileSync(path, "utf8"), projects)
    : {};
}

function isInside(path: string, dir: string): boolean {
  return path.startsWith(`${dir}/`);
}

export function changedSubprojects(
  projects: string[],
  config: SubprojectConfig,
  changedPaths: string[]
): string[] {
  if (changedPaths.includes(CONFIG_PATH)) return projects;

  return projects.filter((project) => {
    const dirs = [project, ...(config[project]?.overlays ?? [])];
    return changedPaths.some((path) => dirs.some((dir) => isInside(path, dir)));
  });
}

export function parseGateOptions(args: string[]): GateOptions {
  return { build: args.includes("--build"), changedOnly: args.includes("--changed") };
}

function changedPaths(root: string): string[] {
  return pathsInPorcelain(
    git(root, ["status", "--porcelain=v1", "--untracked-files=all"])
  );
}

function readManifest(dir: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

function dependsOn(dir: string, name: string): boolean {
  const manifest = readManifest(dir);
  return name in { ...manifest.dependencies, ...manifest.devDependencies };
}

function packageBin(dir: string, pkg: string, bin: string): string | null {
  const manifestPath = join(dir, "node_modules", pkg, "package.json");
  if (!existsSync(manifestPath)) return null;
  const bins: Record<string, string> = JSON.parse(readFileSync(manifestPath, "utf8")).bin;

  return join(dirname(manifestPath), bins[bin]);
}

function toolBin(pkg: string, bin: string): string {
  const path = packageBin(TOOLS_ROOT, pkg, bin);
  if (path === null) throw new Error(`${pkg} is not installed in ${TOOLS_ROOT}`);

  return path;
}

function projectOrToolBin(dir: string, pkg: string, bin: string): string {
  return packageBin(dir, pkg, bin) ?? toolBin(pkg, bin);
}

const installStep: Step = {
  name: "install",
  command: () => [process.execPath, "install", "--frozen-lockfile", "--ignore-scripts"],
};

function typeCheckSteps(dir: string): Step[] {
  const tsc: Step = {
    name: "tsc",
    command: () => [
      process.execPath,
      projectOrToolBin(dir, "typescript", "tsc"),
      "--noEmit",
      "--incremental",
      "false",
    ],
  };
  if (!dependsOn(dir, "next")) return [tsc];
  const typegen: Step = {
    name: "next typegen",
    command: () => [process.execPath, "run", "next", "typegen"],
  };

  return [typegen, tsc];
}

function buildSteps(dir: string, options: GateOptions): Step[] {
  if (!options.build || !readManifest(dir).scripts?.build) return [];

  return [{ name: "build", command: () => [process.execPath, "run", "build"] }];
}

function knipConfigArgs(settings: ProjectSettings, scratch: string): string[] {
  if (!settings.knip) return [];
  const configPath = join(mkdtempSync(join(scratch, "knip-")), "knip.json");
  writeFileSync(configPath, JSON.stringify(settings.knip));

  return ["--config", configPath];
}

function knipStep(dir: string, settings: ProjectSettings, scratch: string): Step {
  return {
    name: "knip",
    command: () => [
      process.execPath,
      toolBin("knip", "knip-bun"),
      "--no-progress",
      "--directory",
      dir,
      ...knipConfigArgs(settings, scratch),
    ],
  };
}

function madgeStep(dir: string): Step {
  const tsConfig = existsSync(join(dir, "tsconfig.json"))
    ? ["--ts-config", "tsconfig.json"]
    : [];

  return {
    name: "madge",
    command: () => [
      process.execPath,
      toolBin("madge", "madge"),
      "--circular",
      "--extensions",
      "ts,tsx,js,jsx,mjs,cjs",
      ...tsConfig,
      "--exclude",
      BUILD_OUTPUT_PATTERN,
      ".",
    ],
  };
}

function projectTarget(
  root: string,
  project: string,
  settings: ProjectSettings,
  options: GateOptions,
  scratch: string
): Target {
  const dir = join(root, project);

  return {
    label: project,
    dir,
    steps: [
      installStep,
      ...typeCheckSteps(dir),
      knipStep(dir, settings, scratch),
      madgeStep(dir),
      ...buildSteps(dir, options),
    ],
  };
}

function filesUnder(root: string, dir: string): string[] {
  return git(root, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    dir,
  ])
    .split("\0")
    .filter((path) => path !== "" && existsSync(join(root, path)))
    .map((path) => path.slice(dir.length + 1));
}

function copyTree(root: string, dir: string, target: string): void {
  const files = filesUnder(root, dir);
  if (files.length === 0) throw new Error(`${dir} has no files to copy`);
  for (const file of files) {
    mkdirSync(dirname(join(target, file)), { recursive: true });
    copyFileSync(join(root, dir, file), join(target, file));
  }
}

function overlayTarget(
  root: string,
  project: string,
  overlay: string,
  options: GateOptions,
  scratch: string
): Target {
  const dir = mkdtempSync(join(scratch, "overlay-"));
  copyTree(root, project, dir);
  copyTree(root, overlay, dir);

  return {
    label: `${project} + ${overlay}`,
    dir,
    steps: [installStep, ...typeCheckSteps(dir), ...buildSteps(dir, options)],
  };
}

function seconds(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(1)}s`;
}

function runStep(target: Target, step: Step): boolean {
  const start = performance.now();
  const [command, ...args] = step.command();
  const r = spawnSync(command, args, {
    cwd: target.dir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (r.status === 0) {
    process.stdout.write(`  ok ${step.name} (${seconds(start)})\n`);
    return true;
  }
  process.stderr.write(
    `${r.stdout ?? ""}${r.stderr ?? ""}${r.error?.message ?? ""}\n` +
      `subprojects: ${target.label} failed at ${step.name} (exit ${r.status})\n`
  );

  return false;
}

function runTarget(prepare: () => Target): boolean {
  const target = prepare();
  process.stdout.write(`${target.label}\n`);
  return target.steps.every((step) => runStep(target, step));
}

function targetsFor(
  root: string,
  project: string,
  settings: ProjectSettings,
  options: GateOptions,
  scratch: string
): (() => Target)[] {
  const overlays = settings.overlays ?? [];

  return [
    () => projectTarget(root, project, settings, options, scratch),
    ...overlays.map(
      (overlay) => () => overlayTarget(root, project, overlay, options, scratch)
    ),
  ];
}

function runSubprojectGates(root: string, options: GateOptions): number {
  const projects = subprojectDirs(lockInputsInCheckout(root));
  const config = readConfig(root, projects);
  const selected = options.changedOnly
    ? changedSubprojects(projects, config, changedPaths(root))
    : projects;
  if (selected.length === 0) {
    process.stdout.write("skipped: no subproject changed\n");
    return 0;
  }
  const scratch = mkdtempSync(join(tmpdir(), "subprojects-"));
  try {
    const passed = selected.every((project) =>
      targetsFor(root, project, config[project] ?? {}, options, scratch).every(runTarget)
    );
    return passed ? 0 : 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (import.meta.main) {
  const root = git(".", ["rev-parse", "--show-toplevel"]).trim();
  process.exit(runSubprojectGates(root, parseGateOptions(process.argv.slice(2))));
}
