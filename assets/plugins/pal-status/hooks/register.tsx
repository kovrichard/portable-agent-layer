import type { EngineInterface, Register } from "claude-code";
import { atom, read, update } from "claude-code";

import type { Notice } from "../types";

const notice = atom({ plugin: "pal-status", key: "notice" } as const, null as Notice);

const READ_HEALTH = ["sh", "-c", 'cat "$HOME/.pal/cache/health.json"'] as const;
const RECHECK_MS = 60_000;

function noticeIn(text: string): Notice {
  try {
    const parsed = JSON.parse(text) as { notice?: unknown };

    return typeof parsed.notice === "string" && parsed.notice !== ""
      ? parsed.notice
      : null;
  } catch {
    return null;
  }
}

async function refresh($: EngineInterface): Promise<void> {
  const run = await $.process.run(READ_HEALTH);
  const current = run.exitCode === 0 ? noticeIn(run.stdout) : null;
  await update($, notice, () => current);
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await refresh($);
    $.clock.every(RECHECK_MS, () => refresh($));

    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    await refresh($);

    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const text = await read($, notice);

    if (e.props.hasSurvey || text === null) {
      return next(e);
    }

    const { Box, Text } = $.ui.resolve(e);

    return (
      <Box>
        <Text color="yellow">⚠ {text} — pal cli doctor</Text>
      </Box>
    );
  });
};
