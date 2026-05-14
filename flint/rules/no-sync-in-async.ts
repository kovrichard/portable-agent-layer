import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { nearestFunctionIsAsync, walkAst } from "../core/ast";
import type { FlintRule } from "../core/types";

export const noSyncInAsync: FlintRule = {
  name: "no-sync-in-async",
  check({ files, root }, violations) {
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      walkAst(file, content, (node, src) => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const name = ts.isIdentifier(callee)
            ? callee.text
            : ts.isPropertyAccessExpression(callee)
              ? callee.name.text
              : null;
          if (
            name?.endsWith("Sync") &&
            name !== "existsSync" &&
            nearestFunctionIsAsync(node)
          ) {
            const { line } = src.getLineAndCharacterOfPosition(node.getStart());
            violations.push({
              file: relative(root, file),
              line: line + 1,
              rule: "no-sync-in-async",
            });
          }
        }
      });
    }
  },
};
