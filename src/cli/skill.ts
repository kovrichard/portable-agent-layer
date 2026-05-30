/**
 * pal cli skill — manage personal skills under ~/.pal/skills/.
 *
 *   pal cli skill link <name>   Link an existing ~/.pal/skills/<name>/ into
 *                               every installed agent so it is discoverable.
 */

import { linkPersonalSkill, log } from "../targets/lib";

export async function runSkill(args: string[]): Promise<number> {
  const [sub, name] = args;

  if (sub === "link") {
    if (!name) {
      log.error("Usage: pal cli skill link <name>");
      return 1;
    }
    try {
      const linked = linkPersonalSkill(name);
      if (linked.length === 0) {
        log.warn(
          `'${name}' linked to no per-skill agents (none installed). ` +
            "It is still discoverable by opencode via ~/.pal/skills/."
        );
      } else {
        log.success(
          `Linked '${name}' into: ${linked.join(", ")} ` +
            "(opencode: auto via ~/.pal/skills/)"
        );
      }
      return 0;
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e));
      return 1;
    }
  }

  log.error("Usage: pal cli skill link <name>");
  return 1;
}
