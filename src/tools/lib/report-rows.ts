import type { Tally } from "./wrapped/year";

export const count = (n: number) => n.toLocaleString("en-US");

export function row(label: string, value: string): string {
  return `    ${label.padEnd(20)} ${value}`;
}

export function tallyLabel(tallies: Tally[]): string {
  if (tallies.length === 0) return "unknown";
  return tallies.map((t) => `${t.name} ${count(t.count)}`).join(" · ");
}

export const counted = (n: number, noun: string) =>
  `${count(n)} ${noun}${n === 1 ? "" : "s"}`;

export const days = (n: number) => counted(n, "day");
