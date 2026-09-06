/**
 * The page's four write calls. Each POSTs one named field and hands back the
 * server's own error text, so a refusal reads the same wherever it surfaces.
 */

async function post(path: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    return payload?.error ?? `${path} answered ${res.status}`;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function setIsc(project: string, id: number, status: "open" | "done") {
  return post("/api/isc", { project, id, status });
}

export function setPlacement(project: string, quadrant: string | null) {
  return post("/api/placement", { project, quadrant });
}

export function setServes(project: string, serves: string) {
  return post("/api/serves", { project, serves });
}

export function setInstallSettings(update: Record<string, string>) {
  return post("/api/settings", update);
}
