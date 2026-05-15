import type { KlintPlugin } from "../core/types";
import { sonarPlugin } from "./sonar";

export const BUILT_IN_PLUGINS: Record<string, KlintPlugin> = {
  sonar: sonarPlugin,
};
