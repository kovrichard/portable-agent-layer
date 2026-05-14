import { relative } from "node:path";
import ts from "typescript";
import { createProgram } from "../core/ast";
import type { Violation } from "../core/types";
import { defineRule } from "../core/types";

export const noFloatingPromise = defineRule({
  name: "no-floating-promise",
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
  violations: Violation[]
): void {
  function visit(node: ts.Node): void {
    if (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      !isHandled(node.expression)
    ) {
      const type = checker.getTypeAtLocation(node.expression);
      if (isPromiseLike(type)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          file: relative(root, sourceFile.fileName),
          line: line + 1,
          rule: "no-floating-promise",
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function isHandled(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const name = node.expression.name.text;
  return name === "catch" || name === "finally";
}

function isPromiseLike(type: ts.Type): boolean {
  if (type.getSymbol()?.name === "Promise") return true;
  if (type.isUnion()) return type.types.some(isPromiseLike);
  return false;
}
