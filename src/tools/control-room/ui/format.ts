export function age(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  if (days < 60) return "1mo";
  return `${Math.floor(days / 30)}mo`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function clock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const day = at.toISOString().slice(0, 10);
  const time = at.toTimeString().slice(0, 5);
  return `${day} ${time}`;
}

export function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function tenths(n: number): string {
  return n.toFixed(1);
}

export function percent(alreadyPercent: number): string {
  return `${Math.round(alreadyPercent)}%`;
}
