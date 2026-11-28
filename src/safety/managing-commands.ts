/** For each protected part of the PAL home, the command its refusal names. */
export const MANAGING_COMMANDS: readonly { under: string; command: string }[] = [
  { under: "bindings.json", command: "pal cli project bindings" },
  { under: "settings.json", command: "pal cli settings set" },
  { under: "telos/", command: "pal cli skill run telos update-telos" },
  { under: "memory/knowledge/", command: "pal cli knowledge add" },
  { under: "work/projects/", command: "pal cli project" },
  { under: "memory/projects/", command: "pal cli project" },
  { under: "state/sync/", command: "pal cli sync" },
];

/** The command for a path below the PAL home, or null when none manages it. */
export function managingCommand(below: string): string | null {
  return (
    MANAGING_COMMANDS.find(({ under }) => below === under || below.startsWith(under))
      ?.command ?? null
  );
}
