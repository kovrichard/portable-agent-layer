import { relative } from "node:path";
import ts from "typescript";
import { walkAst } from "../core/ast";
import type { KlintRule } from "../core/types";

// Unescaped metacharacters that lose their special meaning inside a character class,
// making [.] a valid shorthand for a literal dot without needing \.
const METACHAR_EXCEPTIONS = new Set([".", "*", "+", "?", "{", "}", "(", ")", "|", "$"]);

interface CharClass {
  start: number; // index of '[' in pattern
  end: number; // index of ']' in pattern
  inner: string; // the single token inside
}

function parseCharClasses(pattern: string): CharClass[] {
  const results: CharClass[] = [];
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "\\") {
      i += 2;
      continue;
    }
    if (pattern[i] !== "[") {
      i++;
      continue;
    }
    const start = i++;
    // Negated classes have different semantics — skip
    if (i < pattern.length && pattern[i] === "^") {
      while (i < pattern.length && pattern[i] !== "]") {
        if (pattern[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    const tokens: string[] = [];
    while (i < pattern.length && pattern[i] !== "]") {
      if (pattern[i] === "\\") {
        const s = i++;
        if (i >= pattern.length) break;
        const c = pattern[i];
        if (c === "u" && i + 5 <= pattern.length) {
          i += 5; // \uXXXX
        } else if (c === "x" && i + 3 <= pattern.length) {
          i += 3; // \xXX
        } else if (c === "c" && i + 1 < pattern.length) {
          i += 2; // \cX
        } else {
          i++;
        }
        tokens.push(pattern.slice(s, i));
      } else {
        tokens.push(pattern[i++]);
      }
    }
    if (i >= pattern.length) break;
    const end = i++;
    if (tokens.length === 1) results.push({ start, end, inner: tokens[0] });
  }
  return results;
}

export const noSingleCharClass: KlintRule = {
  check({ files, root, fileContents }, violations) {
    for (const file of files) {
      const content = fileContents.get(file) ?? "";
      walkAst(file, content, (node, src) => {
        if (!ts.isRegularExpressionLiteral(node)) return;

        const regexSrc = node.getText(src);
        const lastSlash = regexSrc.lastIndexOf("/");
        const pattern = regexSrc.slice(1, lastSlash);
        const flags = regexSrc.slice(lastSlash + 1);

        const allClasses = parseCharClasses(pattern);
        const toFix = allClasses.filter((c) => !METACHAR_EXCEPTIONS.has(c.inner));
        if (toFix.length === 0) return;

        // Build fixed pattern: replace [token] with token for non-exceptions
        let fixedPattern = "";
        let prev = 0;
        for (const cls of allClasses) {
          if (METACHAR_EXCEPTIONS.has(cls.inner)) continue;
          fixedPattern += pattern.slice(prev, cls.start);
          fixedPattern += cls.inner;
          prev = cls.end + 1;
        }
        fixedPattern += pattern.slice(prev);

        const fixedRegex = `/${fixedPattern}/${flags}`;
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
          linesText.slice(0, nodeOffset) + fixedRegex + linesText.slice(nodeEndOffset);

        violations.push({
          file: relative(root, file),
          line: line + 1,
          message: `Character class [${toFix[0].inner}] contains a single element — remove the brackets.`,
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
