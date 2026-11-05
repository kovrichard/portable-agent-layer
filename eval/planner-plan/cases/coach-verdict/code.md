// assets/plugins/dark-factory/scripts/coach.mjs
export function startCoach(taskId, status, env = process.env) {
  if (!COACHED_STATUSES.includes(status)) return;
  try {
    appendEvent({ event: "coach_started", task: taskId }, env);
    spawn(process.execPath, [join(PLUGIN_ROOT, "scripts", "coach.mjs"), "run", taskId], {
      detached: true,
      stdio: "ignore",
      env,
    }).unref();
  } catch (error) {
    swallow(() =>
      appendEvent({ event: "coach_failed", task: taskId, error: error.message }, env)
    );
  }
}

function taskTranscripts(task, env) {
  return readEvents(env)
    .filter((event) => event.task === task.id && event.event === "role_finished")
    .filter((event) => event.role !== "coach")
    .map((event) => ({
      role: event.role,
      sessionId: event.sessionId,
      path:
        event.transcriptPath ?? transcriptPathFor(task.worktree, event.sessionId, env),
    }))
    .filter((transcript) => transcript.path);
}

function correctionLines(corrections) {
  return corrections.flatMap((correction) =>
    correction.commits.flatMap((commit) => [
      `### ${correction.task} ${commit.sha}`,
      commit.message,
      "```diff",
      commit.diff,
      "```",
    ])
  );
}

export function coachInstructions({
  specPath,
  artifacts,
  eventsPath,
  diffCommand,
  transcripts,
  openFindings,
  corrections,
}) {
  return [
    `Spec: ${specPath}. Its Decisions section is part of the spec.`,
    "Other artifacts:",
    ...listOrNone(artifacts.map((path) => `- ${path}`)),
    `Events of this task: ${eventsPath}`,
    `Diff of the run: run \`${diffCommand}\``,
    "Role transcripts:",
    ...listOrNone(
      transcripts.map((item) => `- ${item.role} · ${item.sessionId} · ${item.path}`)
    ),
    `Role prompts: ${PLUGIN_ROOT}/agents/<role>.md; the po role also covers ${PLUGIN_ROOT}/skills/po/SKILL.md.`,
    `Metrics: ${Object.keys(METRICS).join(", ")}`,
    "Open findings (pending ones take updates, rejected classes must not come back):",
    ...listOrNone(openFindings.map(findingLine)),
    "Corrections the user made after the factory:",
    ...listOrNone(correctionLines(corrections)),
  ].join("\n");
}

function coachRun(taskId, env, now) {
  const task = readTask(taskId, env);
  if (!existsSync(task.worktree))
    throw new Error(`the worktree of ${taskId} is gone: ${task.worktree}`);
  const corrections = userCorrections(env);
  const { text, command } = runDiff(task, env);
  const correctionDiffs = corrections.flatMap((correction) =>
    correction.commits.map((commit) => commit.diff)
  );
  const names = diffNames([text, ...correctionDiffs].join("\n"));
  const dir = taskDir(taskId, env);
  const instructions = coachInstructions({
    specPath: join(dir, "spec.md"),
    artifacts: artifactPaths(dir),
    eventsPath: join(dir, "events.jsonl"),
    diffCommand: command,
    transcripts: taskTranscripts(task, env),
    openFindings: openFindingsOf(env),
    corrections,
  });
  const outcome = runRoleHeadless(taskId, "coach", { env, instructions });
  if (outcome.exitCode !== 0 || outcome.structured === null)
    return coachFailed(taskId, outcome.error ?? "the coach returned no result", env);
  const applied = withFindingsLock(env, () => {
    const result = applyCoachResult(readFindings(env), outcome.structured, {
      taskId,
      names,
      now,
    });
    writeFindings(result.store, env);
    return result;
  });
  for (const event of applied.events) appendEvent(event, env);
  if (!discardedEveryRule(applied)) recordCorrectionsGiven(corrections, env);
  appendEvent(
    {
      event: "coach_finished",
      task: taskId,
      created: applied.created.length,
      updated: applied.updated.length,
    },
    env
  );
  return {
    task: taskId,
    created: applied.created,
    updated: applied.updated,
    rejectedRules: applied.events
      .filter((event) => event.event === "coach_rule_rejected")
      .map((event) => ({ class: event.class, matched: event.matched })),
  };
}

export function runCoach(taskId, { env = process.env, now = new Date() } = {}) {
  try {
    return coachRun(taskId, env, now);
  } catch (error) {
    return coachFailed(taskId, error.message, env);
  }
}
