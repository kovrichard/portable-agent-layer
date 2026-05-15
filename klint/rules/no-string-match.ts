import { relative } from "node:path";
import ts from "typescript";
import { walkAst } from "../core/ast";
import type { KlintRule } from "../core/types";

export const noStringMatch: KlintRule = {
  check({ files, root, fileContents }, violations) {
    for (const file of files) {
      const content = fileContents.get(file) ?? "";
      walkAst(file, content, (node, src) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "match" &&
          node.arguments.length === 1 &&
          ts.isRegularExpressionLiteral(node.arguments[0])
        ) {
          const flags = regexFlags(node.arguments[0].text);
          if (!flags.includes("g")) {
            const strText = (
              node.expression as ts.PropertyAccessExpression
            ).expression.getText(src);
            const regexText = node.arguments[0].getText(src);
            const { line: s } = src.getLineAndCharacterOfPosition(node.getStart());
            const { line: e } = src.getLineAndCharacterOfPosition(node.getEnd());
            const fix =
              s === e
                ? (() => {
                    const lineStart = src.getPositionOfLineAndCharacter(s, 0);
                    const nlPos = src.text.indexOf("\n", lineStart);
                    const lineText = src.text.slice(
                      lineStart,
                      nlPos === -1 ? undefined : nlPos
                    );
                    const fixed = lineText.replace(
                      node.getText(src),
                      `new RegExp(${regexText}).exec(${strText})`
                    );
                    return { startLine: s + 1, endLine: e + 1, replacement: fixed };
                  })()
                : undefined;
            violations.push({
              file: relative(root, file),
              line: s + 1,
              message: `Use RegExp.exec() instead of String.match() for non-global regexes — use new RegExp(${regexText}).exec(${strText}) instead.`,
              fix,
            });
          }
        }
      });
    }
  },
};

function regexFlags(literal: string): string {
  const last = literal.lastIndexOf("/");
  return last > 0 ? literal.slice(last + 1) : "";
}
