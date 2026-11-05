import { regenerateIfNeeded } from "../hooks/lib/claude-md";
import {
  type Environment,
  readEnvironment,
  refreshEnvironment,
  renderEnvironment,
} from "../hooks/lib/environment";
import { leaf } from "../tools/lib/command";

function currentEnvironment(refresh: boolean): Environment {
  if (refresh) {
    const env = refreshEnvironment();
    regenerateIfNeeded();
    return env;
  }
  return readEnvironment() ?? refreshEnvironment();
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
