import type { KlintPlugin } from "../core/types";
import { preferNullishCoalescingAssign } from "../rules/prefer-nullish-coalescing-assign";
import { preferStringRaw } from "../rules/prefer-string-raw";
import { preferStringRawRegexp } from "../rules/prefer-string-raw-regexp";
import { preferStringReplaceall } from "../rules/prefer-string-replaceall";

export const sonarPlugin: KlintPlugin = {
  name: "sonar",
  rules: {
    "sonar/prefer-string-replaceall": "error",
    "sonar/prefer-string-raw-regexp": "error",
    "sonar/prefer-string-raw": "error",
    "sonar/prefer-nullish-coalescing-assign": "error",
  },
  implementations: {
    "sonar/prefer-string-replaceall": { check: preferStringReplaceall.check },
    "sonar/prefer-string-raw-regexp": { check: preferStringRawRegexp.check },
    "sonar/prefer-string-raw": { check: preferStringRaw.check },
    "sonar/prefer-nullish-coalescing-assign": {
      check: preferNullishCoalescingAssign.check,
    },
  },
};
