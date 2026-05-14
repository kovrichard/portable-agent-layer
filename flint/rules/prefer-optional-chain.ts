import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { walkAst } from "../core/ast";
import type { FlintRule } from "../core/types";

export const preferOptionalChain: FlintRule = {
  name: "prefer-optional-chain",
  check({ files, root }, violations) {
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      walkAst(file, content, (node, src) => {
        if (
          !ts.isBinaryExpression(node) ||
          node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken
        )
          return;

        const leftText = node.left.getText(src);
        const rightText = node.right.getText(src);

        if (
          rightText.startsWith(`${leftText}.`) ||
          rightText.startsWith(`${leftText}[`)
        ) {
          const { line } = src.getLineAndCharacterOfPosition(node.getStart());
          violations.push({
            file: relative(root, file),
            line: line + 1,
            rule: "prefer-optional-chain",
            message: `Use optional chaining instead of && guard — \`${leftText} && ${rightText}\` can be written as \`${rightText.replace(`${leftText}.`, `${leftText}?.`)}\`.`,
          });
        }
      });
    }
  },
};
