import type { AgendaView } from "../data";
import { Pending, useLoaded } from "./panel";

function Age({ view }: { view: AgendaView }) {
  if (!view.generatedAt) return <span className="agenda-age">never written</span>;
  const hours = view.ageHours ?? 0;
  const text = hours < 1 ? "written just now" : `written ${hours}h ago`;
  return (
    <span className={view.stale ? "agenda-age stale" : "agenda-age"}>
      {view.stale ? `${text} — out of date` : text}
    </span>
  );
}

export function Agenda() {
  const loaded = useLoaded<AgendaView>("/api/agenda");

  return (
    <section className="agenda">
      <header>
        <h2>Today</h2>
        {loaded.state === "ready" && <Age view={loaded.data} />}
      </header>
      <Pending value={loaded} />
      {loaded.state === "ready" &&
        (loaded.data.moves.length === 0 ? (
          <p className="agenda-empty">
            No moves yet. They are written when a session ends — finish one and come back.
          </p>
        ) : (
          <ol className="moves">
            {loaded.data.moves.map((move, i) => (
              <li key={move.move}>
                <span className="rank">{i + 1}</span>
                <span className="move">{move.move}</span>
                <span className="because">{move.because}</span>
              </li>
            ))}
          </ol>
        ))}
    </section>
  );
}
