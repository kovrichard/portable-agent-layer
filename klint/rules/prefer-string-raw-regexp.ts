import { relative } from "node:path";
import ts from "typescript";
import { walkAst } from "../core/ast";
import type { KlintRule } from "../core/types";

export const preferStringRawRegexp: KlintRule = {
  check({ files, root, fileContents }, violations) {
    for (const file of files) {
      const content = fileContents.get(file) ?? "";
      walkAst(file, content, (node, src) => {
        if (
          !ts.isNewExpression(node) ||
          !ts.isIdentifier(node.expression) ||
          node.expression.text !== "RegExp" ||
          !node.arguments ||
          node.arguments.length === 0
        )
          return;

        const arg = node.arguments[0];
        if (!ts.isNoSubstitutionTemplateLiteral(arg) && !ts.isTemplateExpression(arg))
          return;

        if (!hasDoubleBackslash(arg as ts.TemplateLiteral, src)) return;

        const { line } = src.getLineAndCharacterOfPosition(node.getStart());
        const { line: argStartLine } = src.getLineAndCharacterOfPosition(arg.getStart());
        const { line: argEndLine } = src.getLineAndCharacterOfPosition(arg.getEnd());

        const lineStarts = src.getLineStarts();
        const lineStart = lineStarts[argStartLine];
        const lineEnd =
          argEndLine + 1 < lineStarts.length
            ? lineStarts[argEndLine + 1] - 1
            : src.text.length;
        const linesText = src.text.slice(lineStart, lineEnd);

        const argOffset = arg.getStart() - lineStart;
        const argEndOffset = arg.getEnd() - lineStart;
        const fixedArg = toStringRaw(arg as ts.TemplateLiteral, src);
        const fixedLines =
          linesText.slice(0, argOffset) + fixedArg + linesText.slice(argEndOffset);

        violations.push({
          file: relative(root, file),
          line: line + 1,
          message:
            "Use String.raw`...` for RegExp template argument to avoid double backslashes (Sonar S7780).",
          fix: {
            startLine: argStartLine + 1,
            endLine: argEndLine + 1,
            replacement: fixedLines,
          },
        });
      });
    }
  },
};

function hasDoubleBackslash(node: ts.TemplateLiteral, src: ts.SourceFile): boolean {
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.getText(src).includes("\\\\");
  }
  if (node.head.getText(src).includes("\\\\")) return true;
  for (const span of node.templateSpans) {
    if (span.literal.getText(src).includes("\\\\")) return true;
  }
  return false;
}

function toStringRaw(node: ts.TemplateLiteral, src: ts.SourceFile): string {
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    const raw = node.getText(src);
    const inner = raw.slice(1, -1);
    return `String.raw\`${inner.replaceAll("\\\\", "\\")}\``;
  }
  let result = "String.raw`";
  const headSrc = node.head.getText(src);
  result += `${headSrc.slice(1, -2).replaceAll("\\\\", "\\")}\${`;
  for (const span of node.templateSpans) {
    result += span.expression.getText(src);
    const litSrc = span.literal.getText(src);
    const isMiddle = ts.isTemplateMiddle(span.literal);
    const litContent = isMiddle ? litSrc.slice(1, -2) : litSrc.slice(1, -1);
    result += `}${litContent.replaceAll("\\\\", "\\")}${isMiddle ? "${" : "`"}`;
  }
  return result;
}
