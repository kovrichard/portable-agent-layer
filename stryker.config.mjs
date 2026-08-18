import { readdirSync } from "node:fs";

// Stryker switches a mutant on through an in-process global, which a child process
// never sees. These suites drive the code under test with Bun.spawn, so their mutants
// score as uncovered no matter how well they assert — leaving them out keeps the ring
// honest instead of padding it with phantom survivors.
const SUBPROCESS_SUITES = new Set([
  "test/cli.test.ts",
  "test/export.test.ts",
  "test/flagship-author.test.ts",
  "test/import-merge.test.ts",
  "test/install-smoke.test.ts",
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
  // Measured 2026-08-18 over the whole ring: 10823 mutants, 37.43% total / 70.90% of
  // covered, 0 errors. `break` stays null until the CLI-entrypoint tools under
  // src/tools/ have in-process tests — a threshold guessed before that just gets
  // disabled the first time it fires. The PR gate reports; it does not yet block.
  thresholds: { high: 80, low: 60, break: null },
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
