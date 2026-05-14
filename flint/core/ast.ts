import ts from "typescript";

export function nearestFunctionIsAsync(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur)
    ) {
      return cur.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
    }
    cur = cur.parent;
  }
  return false;
}

export function isInsideTry(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isTryStatement(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

export function walkAst(
  filePath: string,
  content: string,
  visitor: (node: ts.Node, src: ts.SourceFile) => void
): void {
  const src = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  function recurse(node: ts.Node): void {
    visitor(node, src);
    ts.forEachChild(node, recurse);
  }
  recurse(src);
}
