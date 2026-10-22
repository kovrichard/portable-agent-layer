/**
 * The prompt field carries more than the user typed: IDE tags, reminders, task
 * notifications and continuation boilerplate arrive through the same hook.
 */

const INJECTED_TAG_RE =
  /<(?:ide_opened_file|ide_selection|system-reminder|task-notification)[^>]*>[\s\S]*?<\/(?:ide_opened_file|ide_selection|system-reminder|task-notification)>/gi;

export function stripInjectedTags(prompt: string): string {
  return prompt.replace(INJECTED_TAG_RE, "").trim();
}

const OPENS_TURN_WITHOUT_USER = [
  /^<task-notification>/i,
  /^Another Claude session sent a message:/i,
  /^<agent-message\b/i,
];

const SYSTEM_TEXT_PATTERNS = [
  ...OPENS_TURN_WITHOUT_USER,
  /^<system-reminder>/i,
  /^This session is being continued from a previous conversation/i,
  /^Please continue the conversation/i,
  /^Note:.*was read before/i,
];

export function opensTurnWithoutUser(prompt: string): boolean {
  const trimmed = prompt.trim();
  return OPENS_TURN_WITHOUT_USER.some((re) => re.test(trimmed));
}

export function isSystemText(prompt: string): boolean {
  const trimmed = prompt.trim();
  return SYSTEM_TEXT_PATTERNS.some((re) => re.test(trimmed));
}
