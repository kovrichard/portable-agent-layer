import { regenerateIfNeeded } from "../hooks/lib/claude-md";
import {
  type Environment,
  type Probe,
  readEnvironment,
  refreshEnvironment,
  renderEnvironment,
  systemProbe,
} from "../hooks/lib/environment";
import { leaf } from "../tools/lib/command";

export function currentEnvironment(
  refresh: boolean,
  probe: Probe = systemProbe
): Environment {
  if (refresh) {
    const env = refreshEnvironment(probe);
    regenerateIfNeeded();

    return env;
  }

  return readEnvironment() ?? refreshEnvironment(probe);
}

export const envCommand = leaf({
  summary: "The OS and script languages PAL tells every agent about",
  options: {
    refresh: {
      type: "boolean",
      description: "Detect again and rewrite AGENTS.md (after installing a language)",
    },
  },
  run: ({ values }) => {
    process.stdout.write(renderEnvironment(currentEnvironment(Boolean(values.refresh))));
  },
});
