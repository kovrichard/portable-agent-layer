import { relative } from "node:path";
import ts from "typescript";
import { walkAst } from "../core/ast";
import type { KlintRule } from "../core/types";

export const preferStringRaw: KlintRule = {
  check({ files, root, fileContents }, violations) {
    for (const file of files) {
      const content = fileContents.get(file) ?? "";
      walkAst(file, content, (node, src) => {
        if (!ts.isStringLiteral(node)) return;

        const sourceText = node.getText(src);
        if (!sourceText.includes("\\\\")) return;

        const value = node.text;
        // Can't embed backtick, ${ (would start interpolation), or trailing \ (would escape closing backtick)
        if (value.includes("`") || value.includes("${") || value.endsWith("\\")) return;

        const { line } = src.getLineAndCharacterOfPosition(node.getStart());
        const { line: endLine } = src.getLineAndCharacterOfPosition(node.getEnd());
        const lineStarts = src.getLineStarts();
        const lineStart = lineStarts[line];
        const lineEnd =
          endLine + 1 < lineStarts.length ? lineStarts[endLine + 1] - 1 : src.text.length;
        const linesText = src.text.slice(lineStart, lineEnd);
        const nodeOffset = node.getStart() - lineStart;
        const nodeEndOffset = node.getEnd() - lineStart;
        const fixedNode = `String.raw\`${value}\``;
        const fixedLines =
          linesText.slice(0, nodeOffset) + fixedNode + linesText.slice(nodeEndOffset);

        violations.push({
          file: relative(root, file),
          line: line + 1,
          message:
            "String literal with escaped backslashes — use String.raw`...` for clarity (Sonar S6535).",
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
