import type { KlintPlugin } from "../core/types";
import { noSingleCharClass } from "../rules/no-single-char-class";
import { preferAt } from "../rules/prefer-at";
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
    "sonar/no-single-char-class": "error",
    "sonar/prefer-at": "error",
  },
  implementations: {
    "sonar/prefer-string-replaceall": { check: preferStringReplaceall.check },
    "sonar/prefer-string-raw-regexp": { check: preferStringRawRegexp.check },
    "sonar/prefer-string-raw": { check: preferStringRaw.check },
    "sonar/prefer-nullish-coalescing-assign": {
      check: preferNullishCoalescingAssign.check,
    },
    "sonar/no-single-char-class": { check: noSingleCharClass.check },
    "sonar/prefer-at": { check: preferAt.check },
  },
};
