import { relative } from "node:path";
import ts from "typescript";
import { walkAst } from "../core/ast";
import type { KlintRule } from "../core/types";

export const preferAt: KlintRule = {
  check({ files, root, fileContents }, violations) {
    for (const file of files) {
      const content = fileContents.get(file) ?? "";
      walkAst(file, content, (node, src) => {
        // Match: base[base.length - n]
        if (!ts.isElementAccessExpression(node)) return;

        const arg = node.argumentExpression;
        if (!ts.isBinaryExpression(arg)) return;
        if (arg.operatorToken.kind !== ts.SyntaxKind.MinusToken) return;
        if (!ts.isPropertyAccessExpression(arg.left)) return;
        if (arg.left.name.text !== "length") return;
        if (!ts.isNumericLiteral(arg.right)) return;

        const n = Number(arg.right.text);
        // n=0 changes semantics: arr[arr.length - 0] is undefined, arr.at(-0) is arr[0]
        if (!Number.isInteger(n) || n <= 0) return;

        const baseText = node.expression.getText(src);
        if (baseText !== arg.left.expression.getText(src)) return;

        const fixedCall = `${baseText}.at(-${n})`;
        const { line } = src.getLineAndCharacterOfPosition(node.getStart());
        const { line: endLine } = src.getLineAndCharacterOfPosition(node.getEnd());
        const lineStarts = src.getLineStarts();
        const lineStart = lineStarts[line];
        const lineEnd =
          endLine + 1 < lineStarts.length ? lineStarts[endLine + 1] - 1 : src.text.length;
        const linesText = src.text.slice(lineStart, lineEnd);
        const nodeOffset = node.getStart() - lineStart;
        const nodeEndOffset = node.getEnd() - lineStart;
        const fixedLines =
          linesText.slice(0, nodeOffset) + fixedCall + linesText.slice(nodeEndOffset);

        violations.push({
          file: relative(root, file),
          line: line + 1,
          message: `Prefer ${baseText}.at(-${n}) over ${baseText}[${baseText}.length - ${n}] for cleaner negative indexing.`,
          fix: {
            startLine: line + 1,
            endLine: endLine + 1,
            replacement: fixedLines,
          },
        });
      });
    }
  },
};
