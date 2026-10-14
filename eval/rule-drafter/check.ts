/**
 * Grades one dev-case output for promptfoo; the proof runs over the case's
 * corrections and the ordinary turns in cases.ts.
 *   stdin: {"caseId": "D1", "output": "<model output>"}
 *   argv: [next] grades whether the trigger catches the later correction
 *   stdout: {"pass": boolean, "reason": string}
 */
import { asTurns, CASES, type DrafterCase, ORDINARY } from "./cases";
import { grade, gradeNext } from "./grading";

const { caseId, output } = JSON.parse(await Bun.stdin.text()) as {
  caseId: string;
  output: string;
};
function graded(c: DrafterCase) {
  if (Bun.argv[2] === "next") return gradeNext(c, output);
  return grade(c, output, [...asTurns(c.corrections), ...ORDINARY]);
}

const found = CASES.find((c) => c.id === caseId);
console.log(
  JSON.stringify(found ? graded(found) : { pass: false, reason: `no case ${caseId}` })
);
