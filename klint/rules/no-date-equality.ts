import { relative } from "node:path";
import ts from "typescript";
import { createProgram } from "../core/ast";
import type { RawViolation } from "../core/types";
import { defineRule } from "../core/types";

export const noDateEquality = defineRule({
  check({ files, root }, violations) {
    const program = createProgram(files, root);
    const checker = program.getTypeChecker();
    const fileSet = new Set(files);

    for (const sourceFile of program.getSourceFiles()) {
      if (!fileSet.has(sourceFile.fileName) || sourceFile.isDeclarationFile) continue;
      visitFile(sourceFile, checker, root, violations);
    }
  },
});

function visitFile(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  root: string,
  violations: RawViolation[]
): void {
  function visit(node: ts.Node): void {
    if (ts.isBinaryExpression(node)) {
      const { kind } = node.operatorToken;
      if (
        kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
      ) {
        const leftType = checker.getTypeAtLocation(node.left);
        const rightType = checker.getTypeAtLocation(node.right);
        if (isDateType(leftType) && isDateType(rightType)) {
          const op = node.operatorToken.getText(sourceFile);
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          violations.push({
            file: relative(root, sourceFile.fileName),
            line: line + 1,
            message: `Date values compared with ${op} — this compares object references, not time values. Use .getTime() or .valueOf() instead.`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function isDateType(type: ts.Type): boolean {
  if (type.getSymbol()?.name === "Date") return true;
  if (type.isUnion()) return type.types.some(isDateType);
  return false;
}
