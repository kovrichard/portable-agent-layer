import { relative } from "node:path";
import ts from "typescript";
import { createProgram } from "../core/ast";
import type { RawViolation } from "../core/types";
import { defineRule } from "../core/types";

export const noMisusedPromises = defineRule({
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
    if (ts.isCallExpression(node)) {
      const sig = checker.getResolvedSignature(node);
      if (sig) {
        const params = sig.getParameters();
        for (let i = 0; i < node.arguments.length; i++) {
          const arg = node.arguments[i];
          if (!isAsyncFunction(arg)) continue;

          const param = params[Math.min(i, params.length - 1)];
          if (!param) continue;

          const paramType = checker.getTypeOfSymbolAtLocation(param, node);
          if (expectsSyncCallback(paramType, checker)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(arg.getStart());
            violations.push({
              file: relative(root, sourceFile.fileName),
              line: line + 1,
              message:
                "Async function passed where a sync callback is expected — the caller cannot await it and errors will be silently lost.",
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function isAsyncFunction(
  node: ts.Node
): node is ts.ArrowFunction | ts.FunctionExpression {
  return (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false)
  );
}

function expectsSyncCallback(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (type.isUnion()) {
    const callable = type.types.filter(
      (t) => !(t.flags & ts.TypeFlags.Undefined) && !(t.flags & ts.TypeFlags.Null)
    );
    return callable.length > 0 && callable.every((t) => expectsSyncCallback(t, checker));
  }
  const sigs = type.getCallSignatures();
  if (sigs.length === 0) return false;
  return sigs.every((sig) => !returnsPromise(checker.getReturnTypeOfSignature(sig)));
}

function returnsPromise(type: ts.Type): boolean {
  const name = type.getSymbol()?.name;
  if (name === "Promise" || name === "PromiseLike") return true;
  if (type.isUnion()) return type.types.some(returnsPromise);
  return false;
}
