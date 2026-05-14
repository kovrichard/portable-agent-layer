import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { walkAst } from "../core/ast";
import type { FlintRule } from "../core/types";

export const noThrowString: FlintRule = {
  name: "no-throw-string",
  check({ files, root }, violations) {
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      walkAst(file, content, (node, src) => {
        if (
          ts.isThrowStatement(node) &&
          node.expression &&
          isStringLike(node.expression)
        ) {
          const { line } = src.getLineAndCharacterOfPosition(node.getStart());
          violations.push({
            file: relative(root, file),
            line: line + 1,
            rule: "no-throw-string",
            message:
              "String thrown instead of an Error object — plain strings have no stack trace and cannot be caught with instanceof. Use `throw new Error(...)`.",
          });
        }
      });
    }
  },
};

function isStringLike(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  );
}
