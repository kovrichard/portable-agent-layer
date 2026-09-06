import { readdirSync } from "node:fs";

// Stryker switches a mutant on through an in-process global, which a child process
// never sees. These suites drive the code under test with Bun.spawn, so their mutants
// score as uncovered no matter how well they assert — leaving them out keeps the ring
// honest instead of padding it with phantom survivors.
const SUBPROCESS_SUITES = new Set([
  "test/cli.test.ts",
  "test/copilot-context-injection.test.ts",
  "test/export.test.ts",
  "test/flagship-author.test.ts",
  "test/import-merge.test.ts",
  "test/install-smoke.test.ts",
  "test/ledger-hooks.test.ts",
  "test/package-publish.test.ts",
  "test/project-cli.test.ts",
  "test/rtk-wrap.test.ts",
  "test/security-tool-names.test.ts",
  "test/skill-doctor.test.ts",
  "test/skill-link.test.ts",
  "test/spawn-guard.test.ts",
  "test/subagent-link.test.ts",
  "test/update-command.test.ts",
]);

function isInProcessSuite(file) {
  return file.endsWith(".test.ts") && !SUBPROCESS_SUITES.has(file);
}

// The bun runner passes testFiles to `bun test` verbatim and never expands globs, so a
// pattern here silently matches nothing and the run dies on an inspector timeout.
const testFiles = readdirSync("test", { recursive: true })
  .map(String)
  .map((file) => `test/${file}`)
  .filter(isInProcessSuite)
  .sort();

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  plugins: ["@hughescr/stryker-bun-runner"],
  testRunner: "bun",
  coverageAnalysis: "perTest",
  // The ring is the portable core the suite exercises in-process: hook libraries, agent
  // tools, and the shared target helpers. Everything left out is either an entrypoint the
  // suite only reaches by spawning it (src/cli, src/hooks/*.ts) or an OS/network boundary
  // that is stubbed away before a mutant could ever be observed.
  mutate: [
    "src/hooks/lib/**/*.ts",
    "src/tools/**/*.ts",
    "src/targets/lib.ts",
    "!src/hooks/lib/inference.ts",
    "!src/hooks/lib/notify.ts",
    "!src/hooks/lib/stdin.ts",
    "!src/hooks/lib/which.ts",
    // Tools that are only ever spawned and now hold nothing but argv and one
    // library call — the same case as src/cli and src/hooks/*.ts above. Their
    // decisions live in src/tools/lib/, which is measured.
    "!src/tools/session-summary.ts",
    "!src/tools/agent/relationship-note.ts",
    "!src/tools/agent/analyze.ts",
    "!src/tools/token-cost.ts",
    "!src/tools/relationship-reflect.ts",
    "!src/tools/self-model.ts",
    "!src/tools/agent/handoff-note.ts",
    "!src/tools/agent/algorithm-reflect.ts",
    "!src/tools/agent/thread.ts",
    // Ratchet — every entry below measured >=90% no-coverage on 2026-08-18, meaning
    // the in-process suite cannot reach it and its mutants only depress the score.
    // Delete an entry the same commit that gives the module in-process tests, then
    // re-measure and raise thresholds.break. Entries come off this list; they never
    // go back on, and break never moves down without a reason recorded here.
    "!src/tools/agent/project.ts",
    "!src/tools/skill-doctor.ts",
  ],
  concurrency: Number(process.env.STRYKER_CONCURRENCY ?? 4),
  bun: {
    testFiles,
    // No --isolate: bun re-runs the preload and rebuilds the module graph for every file,
    // and this runner's dry-run preload eager-imports every mutated module each time.
    timeout: 120000,
    // Loading the whole suite pushes the runner's inspector handshake past its 5s default.
    inspectorTimeout: 60000,
  },
  reporters: ["clear-text", "progress", "html"],
  // Ratchet. `break` applies to whatever a run mutates, and the only run that gates
  // anything is the diff one — CI never runs the whole ring. Raise it after the
  // modules a change touches measure above the new number
  // (`bunx stryker run --mutate <file>`); lower it only with the reason written here.
  //
  // Do not re-baseline by running the whole ring: 766 of its mutants are static
  // (module-load code Stryker cannot map perTest coverage onto), so it re-runs the
  // full suite for each and takes ~45 minutes to move this number by ~3 points.
  //   rung 1 — 2026-08-18: 54.87% ring -> break 50
  //   rung 2 — 2026-08-18: 58.77% ring -> break 54
  //            (src/targets/lib.ts 16.45% -> 63.67%, no-coverage 875 -> 183)
  //   rung 3 — 2026-08-18: 62.22% ring -> break 57  [last whole-ring measurement]
  //            (relationship.ts 0.00% -> 75.73%, synthesize.ts 1.79% -> 69.53%)
  //            since: context.ts 2.70% -> 63.24%, stop.ts 1.82% -> 77.27%
  thresholds: { high: 80, low: 60, break: 57 },
  // Stryker copies the project into a sandbox with fs.copyFile, which throws ENOTSUP on a
  // symlink. Every entry below is either a symlink farm (agent config dirs, the installed
  // test homes, the vendored skill node_modules) or bulk the suite never reads.
  ignorePatterns: [
    // Kept, minus its one symlink: algorithm-review.test.ts asserts on the real presence
    // of .agents/skills/algorithm-update/SKILL.md to detect a maintainer checkout.
    ".agents/skills/klint-rules",
    ".claude",
    ".codex",
    ".cursor",
    ".github",
    ".husky",
    ".opencode",
    ".test-home*",
    ".test-install-home",
    ".test-tmp",
    "backups",
    "docs",
    "eval",
    "**/node_modules",
    "pal-export-*.zip",
  ],
  tempDirName: ".stryker-tmp",
  // Always clean: a crashed run otherwise leaves sandbox copies of biome.json behind,
  // which biome then rejects as nested root configurations.
  cleanTempDir: "always",
  htmlReporter: { fileName: "reports/mutation.html" },
};
