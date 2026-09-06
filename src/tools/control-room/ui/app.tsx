import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router";
import type { ServerStatus } from "../server";
import { Screen, Scroller, Seg } from "./frame";
import { useLoaded } from "./lib/api";
import { cn } from "./lib/cn";
import { LOG_KEYS, Log, type LogFilter } from "./screens/log";
import { ProjectDetail } from "./screens/project-detail";
import {
  isStatusFilter,
  Projects,
  STATUS_FILTERS,
  type StatusFilter,
} from "./screens/projects";
import { Settings } from "./screens/settings";
import { isLayout, LAYOUTS, type Layout, Today } from "./screens/today";

const LAYOUT_KEY = "pal.control-room.layout";

/**
 * A blueprint's registration marks are drawn 6px outside its border, so a scroll
 * box whose children are blueprints would count them as overflow. The negative
 * margin borrows that room back from the page gutter, leaving content aligned.
 */
const MARK_ROOM = "-m-2 p-2";

function rememberedLayout(): Layout {
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    return isLayout(stored) ? stored : "matrix";
  } catch {
    return "matrix";
  }
}

function remember(layout: Layout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {}
}

function TodayRoute() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("layout");
  const layout = isLayout(asked) ? asked : rememberedLayout();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex justify-end">
        <Seg
          label="layout"
          options={LAYOUTS}
          value={layout}
          onPick={(next) => {
            remember(next);
            setParams({ layout: next });
          }}
        />
      </div>
      <Scroller className={MARK_ROOM}>
        <Today layout={layout} />
      </Scroller>
    </div>
  );
}

function ProjectsRoute() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("status");
  const filter: StatusFilter = isStatusFilter(asked) ? asked : "ranked";
  return (
    <Screen
      title="Projects"
      aside={
        <Seg
          label="status"
          options={STATUS_FILTERS}
          value={filter}
          onPick={(next) => setParams({ status: next })}
        />
      }
    >
      <Projects filter={filter} />
    </Screen>
  );
}

function ProjectDetailRoute() {
  const { slug } = useParams();
  return (
    <Scroller className={MARK_ROOM}>
      <ProjectDetail slug={slug ?? ""} />
    </Scroller>
  );
}

function LogRoute() {
  const [params, setParams] = useSearchParams();
  const filter = Object.fromEntries(
    LOG_KEYS.map((key) => [key, params.get(key) ?? ""])
  ) as LogFilter;
  const update = (next: Partial<LogFilter>) => {
    const merged = { ...filter, ...next };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)));
  };
  return (
    <Screen
      title="Action log"
      aside={
        <span className="text-[12px] text-neutral-700">
          every tool call this install recorded
        </span>
      }
    >
      <Log filter={filter} onFilter={update} />
    </Screen>
  );
}

function SettingsRoute() {
  return (
    <Screen title="Settings">
      <Scroller className={MARK_ROOM}>
        <Settings />
      </Scroller>
    </Screen>
  );
}

const TABS = [
  { to: "/", label: "Today", end: true },
  { to: "/projects", label: "Projects", end: false },
  { to: "/log", label: "Action log", end: false },
  { to: "/settings", label: "Settings", end: false },
] as const;

function Header({ status }: { status: ServerStatus | null }) {
  return (
    <header className="flex flex-wrap items-center gap-5 border-b border-divider bg-bg px-7 py-2.5">
      <div className="flex min-w-[120px] items-baseline gap-2">
        <span className="font-heading text-[22px] font-semibold tracking-wide">PAL</span>
        <span className="eyebrow">control</span>
      </div>
      <nav className="-mb-[11px] flex gap-0.5">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                "font-heading border-b-2 px-3 py-2 text-[15px] font-semibold whitespace-nowrap",
                isActive
                  ? "border-accent text-ink"
                  : "border-transparent text-neutral-600 hover:text-accent"
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2 text-[12px] text-neutral-700">
        <span className="inline-block size-1.5 bg-accent" />
        <b className="font-medium text-ink">{status?.machine ?? "…"}</b>
        <span>
          · {status ? `${status.ledgerFiles} ledger file(s)` : "…"} · port{" "}
          {status?.port ?? "…"}
        </span>
      </div>
    </header>
  );
}

function App() {
  const status = useLoaded<ServerStatus>("/api/status");
  return (
    <BrowserRouter>
      <div className="flex h-screen flex-col overflow-hidden">
        <Header status={status.state === "ready" ? status.data : null} />
        <main className="mx-auto flex w-full max-w-[1480px] min-h-0 flex-1 flex-col px-7 pt-6 pb-6">
          <Routes>
            <Route path="/" element={<TodayRoute />} />
            <Route path="/projects" element={<ProjectsRoute />} />
            <Route path="/projects/:slug" element={<ProjectDetailRoute />} />
            <Route path="/log" element={<LogRoute />} />
            <Route path="/settings" element={<SettingsRoute />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <footer className="flex flex-wrap justify-between gap-4 border-t border-divider px-7 py-3 text-[11px] text-neutral-600">
          <span>
            loopback only · every number from ~/.pal · no model runs on this page
          </span>
          <span>
            {status.state === "ready" ? `up since ${status.data.startedAt}` : ""}
          </span>
        </footer>
      </div>
    </BrowserRouter>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
