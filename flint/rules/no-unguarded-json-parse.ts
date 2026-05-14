import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { isInsideTry, walkAst } from "../core/ast";
import type { FlintRule } from "../core/types";

export const noUnguardedJsonParse: FlintRule = {
  name: "no-unguarded-json-parse",
  check({ files, root }, violations) {
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      walkAst(file, content, (node, src) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "parse" &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "JSON" &&
          !isInsideTry(node)
        ) {
          const { line } = src.getLineAndCharacterOfPosition(node.getStart());
          violations.push({
            file: relative(root, file),
            line: line + 1,
            rule: "no-unguarded-json-parse",
          });
        }
      });
    }
  },
};
