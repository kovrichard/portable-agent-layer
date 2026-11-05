# PRs attach to the progress tree on their own

## Goal

Every PR on the progress tree was attached by hand: since 2026-10-19 there are 20 `pr` attachments in `~/.pal/memory/progress-tree/events.jsonl`, and the agent made every one of them with `pal cli progress attach pr <url>`. When the agent forgets, the node has no PR. The session-start PR check from #142 then has nothing to check, and the node's stopped-at line goes stale.

After this change, a PR reaches its node without the agent doing anything, in two cases:

- **Normal sessions:** a successful `gh pr create` in a session attaches the new PR's URL to that session's active node.
- **Factory builds:** a session that starts a dark-factory build has that task attached to its active node. When the factory opens or adopts the task's PR, the PR attaches to the same node.

Both live in PAL's agent hooks, so they work in any repo, whether or not the repo itself uses PAL.

## Acceptance criteria

1. **`gh pr create`:** after a Bash call whose command runs `gh pr create` and succeeds, the PR URL printed in its output (`https://github.com/<owner>/<repo>/pull/<n>`) is attached to the session's active node as `attach pr <url>`.
   - With no active node, the URL opens the session's node at the project root, the same way a commit does today (`openSessionNode`).
   - If the call fails, or its output has no PR URL, nothing is written.
   - Other `gh pr` commands (`view`, `list`, `checks`, `merge`) never attach anything, even when their output contains a PR URL.
2. **Factory build started:** after a Bash call that starts a dark-factory build (`node …/dark-factory/scripts/build.mjs <task-id>`, in the foreground or the background), the task is attached to the active node as `attach run dark-factory:<task-id>`.
3. **Factory PR:** when the factory's event log (`$DARK_FACTORY_HOME/events.jsonl`, default `~/.dark-factory/events.jsonl`) has a `pr_opened` or `pr_adopted` event for a task attached as in criterion 2, its `pr` URL is attached to the node holding that task.
   - This is checked when a session starts and at the end of every turn, the same moment commits attach today.
   - It is checked in the session's own scope only, and the factory log is read without being changed.
   - Without the factory log, or with a line that doesn't parse, nothing is written and nothing fails.
4. **No duplicates:** a PR already attached to a node, by hand or by these hooks, is never attached to it again.
5. **Agents:** this works in every agent where PAL wires the post-tool hook:
   - Claude Code, Codex, Cursor, Copilot and Antigravity, through `PostToolOrchestrator.ts` → `runPostToolHandlers` in `src/hooks/lib/post-tool.ts`;
   - opencode, through `src/targets/opencode/plugin.ts`.

   The planner checks which of these hand over the Bash output. An agent that doesn't is named in the PR body as not covered, rather than half-supported.
6. **Opt-in and fail-open:** with `dynamicContext.progressTree` off, nothing is read or written. A failure inside these handlers never blocks or changes a tool call, matching the post-tool hook's existing fail-open contract.
7. **Tests cover:**
   - `gh pr create` succeeding, failing, and printing no URL;
   - `gh pr view` printing a URL;
   - no active node;
   - a factory build started in the foreground and in the background;
   - `pr_opened` and `pr_adopted`;
   - a task with no attached node;
   - a missing or bad factory log;
   - no duplicates after a manual attach;
   - the progress tree off;
   - one payload shape per agent from criterion 5.

   Tests never run `gh`, `claude` or a real build.
8. All gates in `.dark-factory.json` pass. Commits are conventional: `test(progress-tree): …` and `feat(progress-tree): …`. One pull request into `canary`.

## Out of scope

- The dark-factory plugin. It stays independent of PAL, and PAL only reads its event log.
- Attaching factory commits or branches.
- PRs opened outside an agent session: on the GitHub website, or from a terminal with no agent.
- Remote hosts other than GitHub.

## Constraint

Nothing in this task may write outside the worktree and the temp folders. Running the CLI by hand needs both `HOME` and `PAL_HOME` pointed at a temp folder: with only `PAL_HOME` set, `pal cli init` installs into the real agent configs under `HOME`. That is what happened during the previous task (2026-10-20, 17:27).

## Decisions

- The spec is approved: build it. The user typed "go" (2026-10-20, 18:13) after installing canary.16 with #142.

- Specced on the user's "yes pls and for normal sessions too" (2026-10-20, 18:06), after he redirected me from git hooks to agent hooks: "not every repo has pal".
- Factory PRs go through the task attachment and the factory's event log. A background build's output never reaches the session's post-tool hook, so watching its output can't work. The plugin already writes `pr_opened` and `pr_adopted` (`ship.mjs:66` and `:96`), and PAL reading that log keeps the plugin PAL-free.
- The `gh pr create` match is on the command itself, not on any PR URL in any output. Otherwise `gh pr view`, or reading a log, would attach PRs the session never opened.
- 2026-10-20: the code-writer asked "The first commit is blocked by klint: test/klint.yaml forbids afterEach under test/, and test/progress-tree-auto-attach.test.ts uses it (line 50). Should I change that file's teardown to a restore at the start of beforeEach (same assertions), or should the test-writer fix it? Also confirm the handler name: I registered `progress-tree` (matching the tests and tests.md) instead of the plan's `progress`."; the PO answered: 1. afterEach: fix it yourself. The klint rule in test/klint.yaml (line 28) says how: "Tests only set up, never tear down: undo the previous test's state at the start of beforeEach instead." This only changes how the test is built, not what the user gets, so it doesn't need to go back to the test-writer. Move the teardown so it runs first in beforeEach, and keep every assertion exactly as it is. Then check two things: `bun run klint` passes, and `bun test test/progress-tree-auto-attach.test.ts` is still red only because the feature is missing. After that, make the `test(progress-tree): …` commit. 2. Handler name: `progress-tree` is right. tests.md line 7 calls for `HANDLERS["progress-tree"]`, `--only=progress-tree` and the matching `assets/templates/settings.claude.json` entry. When tests.md and the plan disagree, the tests win, and `progress-tree` matches the `progress-tree-*` module names. Make sure every place that names the handler uses the same name: the Claude settings template and the opencode plugin lookup if it uses one. Don't leave a stray `--only=progress` anywhere.
