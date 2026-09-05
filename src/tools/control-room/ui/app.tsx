import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ServerStatus } from "../server";
import { Agents } from "./agents";
import { Board } from "./board";
import { Handoffs } from "./handoffs";
import { Ledger } from "./ledger";
import { getJson } from "./panel";
import { Signal } from "./signal";

function Masthead({ status }: { status: ServerStatus | null }) {
  return (
    <div className="masthead">
      <h1>
        PAL <em>control room</em>
      </h1>
      <div className="meta">
        <span>
          machine <b>{status?.machine ?? "…"}</b>
        </span>
        <span>
          ledger <b>{status ? `${status.ledgerFiles} file(s)` : "…"}</b>
        </span>
        <span>
          port <b>{status?.port ?? "…"}</b>
        </span>
      </div>
    </div>
  );
}

function App() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getJson<ServerStatus>("/api/status")
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <div className="room">
      <Masthead status={status} />
      {error && <div className="error">{error}</div>}
      <div className="grid">
        <Board />
        <Signal />
        <Handoffs />
        <Agents />
        <Ledger />
      </div>
      <div className="foot">
        <span>read only · loopback only · every number from ~/.pal</span>
        <span>{status ? `up since ${status.startedAt}` : ""}</span>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
