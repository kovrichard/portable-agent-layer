import { existsSync, readFileSync } from "node:fs";
import { paiPath } from "./paths";

export interface Identity {
  name: string;
  role: string;
  timezone: string;
}

/** Load identity from TELOS MISSION.md first line or fallback */
export function getIdentity(): Identity {
  const defaults: Identity = {
    name: "User",
    role: "unknown",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  const missionPath = paiPath("telos", "MISSION.md");
  if (!existsSync(missionPath)) return defaults;

  const _content = readFileSync(missionPath, "utf-8");
  // TODO: Parse YAML frontmatter from MISSION.md
  // Identity can be embedded as YAML frontmatter or just used as-is
  return defaults;
}
