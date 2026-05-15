import { relative } from "node:path";
import ts from "typescript";
import { walkAst } from "../core/ast";
import type { KlintRule } from "../core/types";

export const noConsecutiveArrayPush: KlintRule = {
  check({ files, root, fileContents }, violations) {
    for (const file of files) {
      const content = fileContents.get(file) ?? "";
      walkAst(file, content, (node, src) => {
        const statements =
          ts.isBlock(node) || ts.isSourceFile(node) ? node.statements : null;
        if (!statements) return;

        let runStart = -1;
        let runReceiver = "";

        const flush = (upTo: number) => {
          if (runStart !== -1 && upTo - runStart >= 2) {
            const { line } = src.getLineAndCharacterOfPosition(
              statements[runStart].getStart()
            );
            violations.push({
              file: relative(root, file),
              line: line + 1,
              message: `${upTo - runStart} consecutive .push() calls on \`${runReceiver}\` — combine into a single .push(a, b, …) call.`,
            });
          }
          runStart = -1;
          runReceiver = "";
        };

        for (let i = 0; i < statements.length; i++) {
          const receiver = getPushReceiver(statements[i], src);
          if (receiver && receiver === runReceiver) {
            // continue the run
          } else {
            flush(i);
            runStart = receiver ? i : -1;
            runReceiver = receiver ?? "";
          }
        }
        flush(statements.length);
      });
    }
  },
};

function getPushReceiver(node: ts.Statement, src: ts.SourceFile): string | null {
  if (!ts.isExpressionStatement(node)) return null;
  const expr = node.expression;
  if (!ts.isCallExpression(expr)) return null;
  if (!ts.isPropertyAccessExpression(expr.expression)) return null;
  if (expr.expression.name.text !== "push") return null;
  return expr.expression.expression.getText(src);
}
