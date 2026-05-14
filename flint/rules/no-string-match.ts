import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { walkAst } from "../core/ast";
import type { FlintRule } from "../core/types";

export const noStringMatch: FlintRule = {
  name: "no-string-match",
  check({ files, root }, violations) {
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      walkAst(file, content, (node, src) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "match" &&
          node.arguments.length === 1 &&
          ts.isRegularExpressionLiteral(node.arguments[0])
        ) {
          const flags = regexFlags(node.arguments[0].text);
          if (!flags.includes("g")) {
            const { line } = src.getLineAndCharacterOfPosition(node.getStart());
            violations.push({
              file: relative(root, file),
              line: line + 1,
              rule: "no-string-match",
              message:
                "Use RegExp.exec() instead of String.match() for non-global regexes — use new RegExp(/pattern/).exec(str) instead of str.match(/pattern/).",
            });
          }
        }
      });
    }
  },
};

function regexFlags(literal: string): string {
  const last = literal.lastIndexOf("/");
  return last > 0 ? literal.slice(last + 1) : "";
}
