import { relative } from "node:path";
import ts from "typescript";
import { walkAst } from "../core/ast";
import type { KlintRule } from "../core/types";

export const preferStringReplaceall: KlintRule = {
  check({ files, root, fileContents }, violations) {
    for (const file of files) {
      const content = fileContents.get(file) ?? "";
      walkAst(file, content, (node, src) => {
        if (
          !ts.isCallExpression(node) ||
          !ts.isPropertyAccessExpression(node.expression) ||
          node.expression.name.text !== "replace" ||
          node.arguments.length !== 2 ||
          !ts.isRegularExpressionLiteral(node.arguments[0])
        )
          return;

        const regexSrc = node.arguments[0].getText(src);
        const flags = extractFlags(regexSrc);
        const pattern = extractPattern(regexSrc);

        if (flags !== "g") return;
        if (!isPlainLiteral(pattern)) return;

        const strText = (
          node.expression as ts.PropertyAccessExpression
        ).expression.getText(src);
        const replacementText = node.arguments[1].getText(src);
        const patternLit = pattern.includes('"')
          ? `'${pattern.replaceAll("'", "\\'")}'`
          : `"${pattern}"`;
        const fixedCall = `${strText}.replaceAll(${patternLit}, ${replacementText})`;

        const { line: s } = src.getLineAndCharacterOfPosition(node.getStart());
        const { line: e } = src.getLineAndCharacterOfPosition(node.getEnd());
        const lineStarts = src.getLineStarts();
        const lineStart = lineStarts[s];
        const lineEnd =
          e + 1 < lineStarts.length ? lineStarts[e + 1] - 1 : src.text.length;
        const linesText = src.text.slice(lineStart, lineEnd);
        const nodeOffset = node.getStart() - lineStart;
        const nodeEndOffset = node.getEnd() - lineStart;
        const fixedLines =
          linesText.slice(0, nodeOffset) + fixedCall + linesText.slice(nodeEndOffset);

        violations.push({
          file: relative(root, file),
          line: s + 1,
          message: `Prefer \`${strText}.replaceAll(${patternLit}, ...)\` over \`.replace(/${pattern}/g, ...)\` — replaceAll() with a string is clearer and avoids regex escaping pitfalls.`,
          fix: {
            startLine: s + 1,
            endLine: e + 1,
            replacement: fixedLines,
          },
        });
      });
    }
  },
};

function extractFlags(literal: string): string {
  const last = literal.lastIndexOf("/");
  return last > 0 ? literal.slice(last + 1) : "";
}

function extractPattern(literal: string): string {
  return literal.slice(1, literal.lastIndexOf("/"));
}

function isPlainLiteral(pattern: string): boolean {
  // Strip escaped-backslash pairs (\\) before checking — \\ is a plain literal, not a metachar
  const stripped = pattern.replaceAll("\\\\", "");
  return !/[.*+?[\]{}()|^$\\]/.test(stripped);
}
