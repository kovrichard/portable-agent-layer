import { relative } from "node:path";
import ts from "typescript";
import { createProgram } from "../core/ast";
import type { RawViolation } from "../core/types";
import { defineRule } from "../core/types";

export const noOptionalChainOnNonNullable = defineRule({
  check({ files, root }, violations) {
    const program = createProgram(files, root);
    const checker = program.getTypeChecker();

    if (!program.getCompilerOptions().strictNullChecks) return;

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
    const receiver = getOptionalChainReceiver(node);
    if (receiver) {
      const type = checker.getTypeAtLocation(receiver);
      if (!isNullable(type)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          file: relative(root, sourceFile.fileName),
          line: line + 1,
          message:
            "Optional chain (?.) on a non-nullable type — the receiver can never be null or undefined here. Use . to remove misleading dead code.",
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function getOptionalChainReceiver(node: ts.Node): ts.Expression | undefined {
  if (
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
    node.questionDotToken
  ) {
    return node.expression;
  }
  if (ts.isCallExpression(node) && node.questionDotToken) {
    return node.expression;
  }
  return undefined;
}

function isNullable(type: ts.Type): boolean {
  if (
    type.flags &
    (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Any | ts.TypeFlags.Unknown)
  )
    return true;
  if (type.isUnion()) return type.types.some(isNullable);
  return false;
}
