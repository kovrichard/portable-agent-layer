import type { KlintPlugin } from "../core/types";

export const sonarPlugin: KlintPlugin = {
  name: "sonar",
  rules: {
    "prefer-string-replaceall": "error",
    "prefer-string-raw-regexp": "error",
    "prefer-nullish-coalescing-assign": "error",
  },
};
