import { useState } from "react";
import type { Matrix, MatrixItem } from "../matrix";
import { Pending, useLoaded } from "./panel";

const QUADRANTS: { key: keyof Matrix; title: string; note: string }[] = [
  { key: "now", title: "Do now", note: "matters and cannot wait" },
  { key: "plan", title: "Give it a slot", note: "matters, nothing forcing it" },
  { key: "noise", title: "Loud, not load-bearing", note: "pressing but serves nothing" },
  { key: "later", title: "Let it sit", note: "neither" },
];

const KINDS = ["goal", "revenue", "fun"] as const;

async function saveServes(project: string, serves: string): Promise<void> {
  const res = await fetch("/api/serves", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project, serves }),
  });
  if (!res.ok) throw new Error(`override answered ${res.status}`);
}

function Serves({ item, onSaved }: { item: MatrixItem; onSaved: () => void }) {
  if (item.kind !== "project") return null;
  return (
    <select
      className={item.servesBy === "user" ? "serves mine" : "serves"}
      value={item.serves ?? ""}
      title={
        item.servesBy === "user" ? "your answer" : "PAL's guess — change it to correct it"
      }
      onChange={(e) => {
        saveServes(item.id, e.target.value)
          .then(onSaved)
          .catch(() => onSaved());
      }}
    >
      <option value="" disabled>
        unranked
      </option>
      {KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {kind}
        </option>
      ))}
    </select>
  );
}

function Item({ item, onSaved }: { item: MatrixItem; onSaved: () => void }) {
  return (
    <li className={`m-item ${item.kind}`}>
      <div className="m-head">
        <span className="m-label">{item.label}</span>
        <Serves item={item} onSaved={onSaved} />
      </div>
      {item.waitingOn && <div className="waiting">waiting on you: {item.waitingOn}</div>}
      {item.detail && <div className="m-detail">{item.detail}</div>}
      <div className="m-reasons">
        <span className="why-important">{item.importantBecause}</span>
        {item.urgentBecause.map((reason) => (
          <span className="why-urgent" key={reason}>
            {reason}
          </span>
        ))}
      </div>
    </li>
  );
}

export function MatrixGrid() {
  const [nonce, setNonce] = useState(0);
  const loaded = useLoaded<Matrix>(`/api/matrix?v=${nonce}`);
  const reload = () => setNonce((n) => n + 1);

  return (
    <section className="matrix">
      <header>
        <h2>What is worth your morning</h2>
        {loaded.state === "ready" && loaded.data.unranked > 0 && (
          <span className="agenda-age stale">
            {loaded.data.unranked} project(s) with no purpose on record
          </span>
        )}
      </header>
      <Pending value={loaded} />
      {loaded.state === "ready" && (
        <div className="quadrants">
          {QUADRANTS.map(({ key, title, note }) => {
            const items = loaded.data[key] as MatrixItem[];
            return (
              <div className={`quadrant q-${key}`} key={key}>
                <div className="q-head">
                  <h3>{title}</h3>
                  <span>{note}</span>
                </div>
                {items.length === 0 ? (
                  <div className="empty">nothing here</div>
                ) : (
                  <ul>
                    {items.map((item) => (
                      <Item
                        key={`${item.kind}:${item.id}`}
                        item={item}
                        onSaved={reload}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
