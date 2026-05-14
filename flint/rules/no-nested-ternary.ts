import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { walkAst } from "../core/ast";
import type { FlintRule } from "../core/types";

export const noNestedTernary: FlintRule = {
  name: "no-nested-ternary",
  check({ files, root }, violations) {
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      walkAst(file, content, (node, src) => {
        if (!ts.isConditionalExpression(node)) return;
        if (
          ts.isConditionalExpression(unwrap(node.whenTrue)) ||
          ts.isConditionalExpression(unwrap(node.whenFalse))
        ) {
          const { line } = src.getLineAndCharacterOfPosition(node.getStart());
          violations.push({
            file: relative(root, file),
            line: line + 1,
            rule: "no-nested-ternary",
            message:
              "Nested ternary is hard to read — use if-else statements or extract conditions to named variables.",
          });
        }
      });
    }
  },
};

function unwrap(node: ts.Node): ts.Node {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}
