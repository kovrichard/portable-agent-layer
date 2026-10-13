import { preserveTranscriptsOnce } from "../hooks/lib/transcript-preserve";
import { group, leaf } from "../tools/lib/command";

function printPreserve(): undefined {
  const result = preserveTranscriptsOnce();
  if (!result) {
    console.log("Another copy is already running.");
    return;
  }
  console.log(
    `Copied ${result.copied}, unchanged ${result.unchanged}, failed ${result.failed}`
  );
}

export const contentCommand = group({
  summary: "PAL's local content store (never exported)",
  commands: {
    preserve: leaf({
      summary: "Copy Claude Code transcripts, gzipped, before Claude Code deletes them",
      run: printPreserve,
    }),
  },
});
