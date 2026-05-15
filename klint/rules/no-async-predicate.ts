import { relative } from "node:path";
import ts from "typescript";
import { createProgram } from "../core/ast";
import type { RawViolation } from "../core/types";
import { defineRule } from "../core/types";

const PREDICATE_METHODS = new Set(["filter", "some", "every", "find", "findIndex"]);

export const noAsyncPredicate = defineRule({
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
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      PREDICATE_METHODS.has(node.expression.name.text) &&
      node.arguments.length > 0
    ) {
      const receiverType = checker.getTypeAtLocation(node.expression.expression);
      if (isArrayLike(receiverType, checker) && isAsyncFunction(node.arguments[0])) {
        const method = node.expression.name.text;
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.arguments[0].getStart()
        );
        violations.push({
          file: relative(root, sourceFile.fileName),
          line: line + 1,
          message: `Async callback passed to .${method}() — the returned Promise is always truthy, so the predicate never filters correctly. The array method cannot await it.`,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function isArrayLike(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (type.isUnion()) return type.types.some((t) => isArrayLike(t, checker));
  const sym = type.getSymbol();
  if (sym?.name === "Array" || sym?.name === "ReadonlyArray") return true;
  const ref = type as ts.TypeReference;
  if (ref.target) {
    const targetSym = ref.target.getSymbol();
    if (targetSym?.name === "Array" || targetSym?.name === "ReadonlyArray") return true;
  }
  return false;
}

function isAsyncFunction(
  node: ts.Node
): node is ts.ArrowFunction | ts.FunctionExpression {
  return (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false)
  );
}
