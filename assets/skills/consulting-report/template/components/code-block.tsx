import type { CodeSample } from "@/lib/types";

interface CodeBlockProps {
  sample: CodeSample;
}

export async function CodeBlock({ sample }: CodeBlockProps) {
  return (
    <div className="my-4 break-inside-avoid">
      <div className="font-sans text-[0.65rem] font-bold uppercase tracking-widest text-primary mb-1">
        {sample.language}
      </div>
      <pre className="rounded-lg overflow-x-auto text-[0.8rem] leading-relaxed px-5 py-4 bg-[#f6f8fa]">
        <code>{sample.code}</code>
      </pre>
      {sample.caption && (
        <p className="text-[0.78rem] text-muted italic mt-1">{sample.caption}</p>
      )}
    </div>
  );
}
