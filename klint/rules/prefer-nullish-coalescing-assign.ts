import { relative } from "node:path";
import ts from "typescript";
import { walkAst } from "../core/ast";
import type { KlintRule } from "../core/types";

export const preferNullishCoalescingAssign: KlintRule = {
  check({ files, root, fileContents }, violations) {
    for (const file of files) {
      const content = fileContents.get(file) ?? "";
      walkAst(file, content, (node, src) => {
        if (
          !ts.isIfStatement(node) ||
          node.elseStatement !== undefined ||
          !ts.isPrefixUnaryExpression(node.expression) ||
          node.expression.operator !== ts.SyntaxKind.ExclamationToken
        )
          return;

        const assignExpr = extractAssignment(node.thenStatement);
        if (!assignExpr) return;

        const xText = node.expression.operand.getText(src);
        if (assignExpr.left.getText(src) !== xText) return;

        const yText = assignExpr.right.getText(src);
        const { line: s } = src.getLineAndCharacterOfPosition(node.getStart());
        const { line: e } = src.getLineAndCharacterOfPosition(node.getEnd());
        const indent = getIndent(src, node);

        violations.push({
          file: relative(root, file),
          line: s + 1,
          message: `Prefer \`${xText} ??= ${yText}\` over \`if (!${xText}) ${xText} = ${yText}\` — ??= only assigns when null or undefined.`,
          fix: {
            startLine: s + 1,
            endLine: e + 1,
            replacement: `${indent}${xText} ??= ${yText};`,
          },
        });
      });
    }
  },
};

function extractAssignment(stmt: ts.Statement): ts.BinaryExpression | undefined {
  if (ts.isExpressionStatement(stmt)) {
    return isAssign(stmt.expression) ? stmt.expression : undefined;
  }
  if (ts.isBlock(stmt) && stmt.statements.length === 1) {
    const inner = stmt.statements[0];
    if (ts.isExpressionStatement(inner) && isAssign(inner.expression)) {
      return inner.expression;
    }
  }
  return undefined;
}

function isAssign(node: ts.Expression): node is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
}

function getIndent(src: ts.SourceFile, node: ts.Node): string {
  const { line } = src.getLineAndCharacterOfPosition(node.getStart());
  const lineStart = src.getPositionOfLineAndCharacter(line, 0);
  return new RegExp(/^(\s*)/).exec(src.text.slice(lineStart, node.getStart()))?.[1] ?? "";
}
