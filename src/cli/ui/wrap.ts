export interface Chunk {
  text: string;
  start: number;
}

export function wrapWords(text: string, width: number): Chunk[] {
  const chunks: Chunk[] = [];
  let line: Chunk | null = null;
  for (const word of text.matchAll(/\S+/g)) {
    const start = word.index ?? 0;
    if (line && start + word[0].length - line.start <= width) {
      line.text = text.slice(line.start, start + word[0].length);
      continue;
    }
    line = { text: word[0], start };
    chunks.push(line);
  }
  return chunks;
}
