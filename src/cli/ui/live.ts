import { mark, railNotes, railRow, seconds } from "./rail";
import type { Style } from "./style";

type NoteLevel = "fail" | "warn" | "info";

export interface Note {
  level: NoteLevel;
  text: string;
}

export interface Done {
  detail: string[];
  notes?: Note[];
}

type Work = () => Promise<Done | null> | Done | null;

const FRAME_MS = 90;
const CLEAR_LINE = "\r\x1b[2K";

const INSTANT_MS = 50;

export const stepTime = (ms: number) => (ms < INSTANT_MS ? "" : seconds(ms));

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Prints the steps of a long command. At a terminal each step spins while it
 * runs and settles into one line; anywhere else it prints one plain line when done.
 */
export class LiveRail {
  constructor(
    private readonly style: Style,
    private readonly write: (text: string) => void = (text) => {
      process.stdout.write(text);
    }
  ) {}

  line(text = ""): void {
    this.write(`${text}\n`);
  }

  async step(name: string, pending: string, work: Work): Promise<Done | null> {
    return this.style.term.rich
      ? this.richStep(name, pending, work)
      : this.plainStep(name, work);
  }

  private noteLines(note: Note): string[] {
    if (note.level === "info") return railNotes(this.style, note.text, this.style.dim);
    return railNotes(
      this.style,
      note.text,
      (text) => text,
      `${mark(this.style, note.level)} `
    );
  }

  private async richStep(
    name: string,
    pending: string,
    work: Work
  ): Promise<Done | null> {
    let frame = 0;
    const draw = () =>
      this.write(
        `${CLEAR_LINE}${railRow(this.style, "spin", name, pending, "", frame)[0]}`
      );
    draw();
    const spinner = setInterval(() => {
      frame += 1;
      draw();
    }, FRAME_MS);
    const started = performance.now();
    try {
      const done = await work();
      clearInterval(spinner);
      this.write(CLEAR_LINE);
      if (done) this.settle(name, done, stepTime(performance.now() - started));
      return done;
    } catch (error) {
      clearInterval(spinner);
      this.write(CLEAR_LINE);
      this.settle(name, { detail: [errorText(error)] }, "", "fail");
      throw error;
    }
  }

  private settle(name: string, done: Done, time: string, kind: "ok" | "fail" = "ok") {
    const detail = done.detail.join(` ${this.style.glyph.dot} `);
    for (const row of railRow(this.style, kind, name, detail, time)) this.line(row);
    for (const note of done.notes ?? [])
      for (const line of this.noteLines(note)) this.line(line);
  }

  private async plainStep(name: string, work: Work): Promise<Done | null> {
    try {
      const done = await work();
      if (done) {
        this.line(`ok   ${name}: ${done.detail.join(", ")}`);
        for (const note of done.notes ?? [])
          this.line(`${note.level.padEnd(4)} ${note.text}`);
      }
      return done;
    } catch (error) {
      this.line(`fail ${name}: ${errorText(error)}`);
      throw error;
    }
  }
}
