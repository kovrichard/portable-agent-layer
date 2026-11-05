// assets/plugins/dark-factory/scripts/role.mjs
export function claudeInvocation(
  task,
  role,
  {
    budgetUsd = 0,
    extraArgs = [],
    env = process.env,
    model,
    instructions,
    resumeSessionId,
    pluginDir = PLUGIN_ROOT,
    instructionsFile,
  } = {}
) {
  const policy = policyFor(role);
  return {
    command: "claude",
    cwd: task.worktree,
    prompt: promptFor(task, role, { instructions, resumeSessionId, env }),
    args: [
      "-p",
      "--agent",
      `dark-factory:${role}`,
      "--output-format",
      "json",
      "--setting-sources",
      "",
      "--plugin-dir",
      pluginDir,
      ...optionalFlag("--append-system-prompt-file", instructionsFile),
      ...optionalFlag("--model", model),
      ...optionalFlag("--resume", resumeSessionId),
      "--json-schema",
      JSON.stringify(schemaFor(role)),
      "--max-budget-usd",
      String(budgetUsd > 0 ? budgetUsd : policy.budgetUsd),
      "--permission-mode",
      "dontAsk",
      "--add-dir",
      taskDir(task.id, env),
      "--allowedTools",
      policy.allow.join(","),
      ...disallowedArgs(policy.deny),
      ...extraArgs,
    ],
  };
}

// assets/plugins/dark-factory/scripts/build.mjs
function saveStatus(run, outcome) {
  try {
    if (outcome.status === "waiting") recordQuestion(run.id, outcome.message, run.env);
    else setStatus(run.id, outcome.status, outcome.message, run.env);
    return null;
  } catch (error) {
    return error.message;
  }
}

function messageWithStatusError(outcome, statusError) {
  if (!statusError) return outcome.message;
  return `${outcome.message} (the task status could not be saved: ${statusError})`;
}

function finishRun(run, outcome) {
  const message = messageWithStatusError(outcome, saveStatus(run, outcome));
  notify(run.id, outcome.status, message, run.env);
  appendEvent(
    {
      event: "run_finished",
      task: run.id,
      status: outcome.status,
      ...runTotals(readEvents(run.env), run.id, run.startedAt.toISOString()),
      wallMs: Date.now() - run.startedAt.getTime(),
    },
    run.env
  );
  return { task: run.id, status: outcome.status, message, pr: run.pr ?? null };
}

export function runBuild(taskId, { env = process.env } = {}) {
  const run = { id: taskId, env, startedAt: new Date(), attempt: 0, pr: null };
  let outcome;
  try {
    outcome = pipeline(run);
  } catch (error) {
    outcome = stuck(error.message);
  }
  return finishRun(run, outcome);
}

// assets/plugins/dark-factory/scripts/roles.mjs
export const ROLE_POLICIES = {
  reviewer: { allow: [...READS, ...READ_ONLY_SHELL], deny: READ_ONLY_DENY, budgetUsd: 2 },
  po: { allow: [...READS, ...READ_ONLY_SHELL], deny: READ_ONLY_DENY, budgetUsd: 1 },
  tester: { allow: [...READS, "Bash"], deny: EDITS, budgetUsd: 3 },
  architect: {
    allow: [...READS, ...READ_ONLY_SHELL, "Edit", "Write"],
    deny: ["NotebookEdit"],
    budgetUsd: 3,
  },
  planner: {
    allow: [...READS, ...READ_ONLY_SHELL, "Edit", "Write"],
    deny: ["NotebookEdit"],
    budgetUsd: 3,
  },
  "test-writer": { allow: [...READS, "Edit", "Write", "Bash"], deny: [], budgetUsd: 3 },
  "code-writer": { allow: [...READS, "Edit", "Write", "Bash"], deny: [], budgetUsd: 2 },
  debugger: { allow: [...READS, "Edit", "Write", "Bash"], deny: [], budgetUsd: 5 },
};

// assets/plugins/dark-factory/scripts/lib.mjs
export function appendEvent(event, env = process.env, now = new Date()) {
  const file = eventsFile(env);
  mkdirSync(dirname(file), { recursive: true });
  const line = `${JSON.stringify({ ts: now.toISOString(), ...event })}\n`;
  appendFileSync(file, line);
  appendToTaskLog(event.task, line, env);
}
