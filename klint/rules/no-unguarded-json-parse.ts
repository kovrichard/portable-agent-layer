import { relative } from "node:path";
import ts from "typescript";
import { isInsideTry, walkAst } from "../core/ast";
import type { KlintRule } from "../core/types";

export const noUnguardedJsonParse: KlintRule = {
  check({ files, root, fileContents }, violations) {
    for (const file of files) {
      const content = fileContents.get(file) ?? "";
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
            message:
              "JSON.parse() called without a surrounding try/catch — a malformed payload will throw an unhandled exception.",
          });
        }
      });
    }
  },
};
