import ts from "typescript";

let _program: { key: string; program: ts.Program } | undefined;
let _sourceFiles: Map<string, ts.SourceFile> = new Map();

export function clearAstCache(): void {
  _program = undefined;
  _sourceFiles = new Map();
}

export function createProgram(files: string[], root: string): ts.Program {
  const key = `${root}\0${[...files].sort().join("\0")}`;
  if (_program?.key === key) return _program.program;
  const configPath = ts.findConfigFile(root, ts.sys.fileExists);
  let options: ts.CompilerOptions = { target: ts.ScriptTarget.Latest, strict: true };
  if (configPath) {
    const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
    options = ts.parseJsonConfigFileContent(config, ts.sys, root).options;
  }
  const program = ts.createProgram(files, options);
  _program = { key, program };
  return program;
}

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
  const cached = _sourceFiles.get(filePath);
  const src =
    cached ?? ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  if (!cached) _sourceFiles.set(filePath, src);
  function recurse(node: ts.Node): void {
    visitor(node, src);
    ts.forEachChild(node, recurse);
  }
  recurse(src);
}
