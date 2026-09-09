import { useEffect, useState } from "react";

export type Loaded<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: T };

async function getJson<T>(path: string): Promise<T> {
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
