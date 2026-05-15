import { relative } from "node:path";
import ts from "typescript";
import { walkAst } from "../core/ast";
import type { KlintRule } from "../core/types";

export const noNestedTemplateLiterals: KlintRule = {
  check({ files, root, fileContents }, violations) {
    for (const file of files) {
      const content = fileContents.get(file) ?? "";
      walkAst(file, content, (node, src) => {
        if (!ts.isTemplateExpression(node)) return;
        for (const span of node.templateSpans) {
          findNestedTemplate(span.expression, src, file, root, violations);
        }
      });
    }
  },
};

function findNestedTemplate(
  node: ts.Node,
  src: ts.SourceFile,
  file: string,
  root: string,
  violations: ReturnType<typeof Array.prototype.slice>
): void {
  if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const { line } = src.getLineAndCharacterOfPosition(node.getStart());
    violations.push({
      file: relative(root, file),
      line: line + 1,
      message:
        "Nested template literal — extract the inner template to a variable to improve readability.",
    });
    return;
  }
  // Don't descend into tagged templates — they are a single semantic unit
  if (ts.isTaggedTemplateExpression(node)) return;
  ts.forEachChild(node, (child) =>
    findNestedTemplate(child, src, file, root, violations)
  );
}
