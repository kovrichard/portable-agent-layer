import { type ReactNode, useEffect, useState } from "react";

interface PanelProps {
  index: string;
  title: string;
  span: number;
  order: number;
  aside?: ReactNode;
  children: ReactNode;
}

export function Panel({ index, title, span, order, aside, children }: PanelProps) {
  return (
    <section
      className="panel"
      style={{ "--span": span, "--i": order } as React.CSSProperties}
    >
      <header>
        <div>
          <span className="index">{index}</span>
          <h2>{title}</h2>
        </div>
        {aside && <span className="aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

export type Loaded<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: T };

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return (await res.json()) as T;
}

export function useLoaded<T>(url: string): Loaded<T> {
  const [value, setValue] = useState<Loaded<T>>({ state: "loading" });
  useEffect(() => {
    let live = true;
    setValue({ state: "loading" });
    getJson<T>(url)
      .then((data) => live && setValue({ state: "ready", data }))
      .catch((e: Error) => live && setValue({ state: "error", message: e.message }));
    return () => {
      live = false;
    };
  }, [url]);
  return value;
}

export function Pending({ value }: { value: Loaded<unknown> }) {
  if (value.state === "loading") return <div className="empty">reading…</div>;
  if (value.state === "error") return <div className="error">{value.message}</div>;
  return null;
}
