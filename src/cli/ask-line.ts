/** One line from the person at the terminal, or all of stdin when it is piped. */
export async function askLine(question: string): Promise<string> {
  if (!process.stdin.isTTY) return await Bun.stdin.text();
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((done) =>
    rl.question(question, (answer) => {
      rl.close();
      done(answer);
    })
  );
}
