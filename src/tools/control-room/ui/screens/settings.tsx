import { useEffect, useState } from "react";
import type {
  AutoUpdateLedger,
  AutoUpdateStatus,
} from "../../../../hooks/lib/auto-update";
import type { ControlRoomPrefs } from "../../prefs";
import type { ServerStatus } from "../../server";
import { Button } from "../components/button";
import { Input } from "../components/input";
import { Label } from "../components/label";
import { Switch } from "../components/switch";
import { clock } from "../format";
import { Empty, Panel, Pending } from "../frame";
import { useLoaded } from "../lib/api";
import {
  runUpdateNow,
  setAutoUpdate,
  setInstallSettings,
  setPrefs as writePrefs,
} from "../lib/write";

interface InstallSettings {
  actor: string;
  timezone: string;
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <span className="text-[11px] text-neutral-600">{hint}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ThisInstall({ initial }: { initial: InstallSettings }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = form.actor !== initial.actor || form.timezone !== initial.timezone;

  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);

  const save = () => {
    void setInstallSettings({ ...form }).then((failure) => {
      setError(failure);
      setSaved(failure === null);
    });
  };

  return (
    <Panel title="This install">
      <div className="flex flex-col gap-4">
        <Field
          label="actor"
          hint="who caused a record — this travels with an export"
          value={form.actor}
          onChange={(actor) => setForm({ ...form, actor })}
        />
        <Field
          label="timezone"
          hint="how dates are read, e.g. Europe/Budapest"
          value={form.timezone}
          onChange={(timezone) => setForm({ ...form, timezone })}
        />
        {error && (
          <p className="border-l-2 border-alarm bg-alarm/10 px-3 py-2 text-[12px] text-alarm">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={!dirty} onClick={save}>
            Save
          </Button>
          {saved && <span className="text-[12px] text-neutral-600">saved</span>}
        </div>
      </div>
    </Panel>
  );
}

function latest(last: AutoUpdateLedger): string {
  return last.finishedAt ?? last.attemptedAt ?? last.skippedAt ?? "";
}

function lastRunLine(last: AutoUpdateLedger | null): string {
  if (!last) return "never run";
  const at = latest(last);
  const when = at ? ` · ${clock(at)}` : "";
  if (at && at === last.skippedAt) return `waited — ${last.skipped}${when}`;
  if (last.finishedAt) {
    return last.ok
      ? `updated ${last.from} → ${last.to}${when}`
      : `failed — ${last.error ?? "unknown error"}${when}`;
  }
  return `running since ${clock(last.attemptedAt ?? "")}`;
}

function versionLine(status: AutoUpdateStatus): string {
  if (status.available && status.latest) return `${status.current} → ${status.latest}`;
  return `${status.current} · up to date`;
}

function Updates({ initial }: { initial: AutoUpdateStatus }) {
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const refresh = () => {
    void fetch("/api/update")
      .then((res) => res.json() as Promise<AutoUpdateStatus>)
      .then(setStatus)
      .catch(() => setError("could not read update status"));
  };

  const toggle = (enabled: boolean) => {
    setStatus({ ...status, enabled });
    void setAutoUpdate(enabled).then((failure) => {
      setError(failure);
      if (failure) setStatus({ ...status, enabled: !enabled });
    });
  };

  const now = () => {
    setRunning(true);
    void runUpdateNow().then((failure) => {
      setError(failure);
      setTimeout(() => {
        setRunning(false);
        refresh();
      }, 4000);
    });
  };

  return (
    <Panel title="Updates">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 text-[12.5px]">
          <span>update once a day, when a session closes</span>
          <Switch
            aria-label="update once a day"
            checked={status.enabled}
            onCheckedChange={toggle}
          />
        </div>
        <dl className="m-0 grid grid-cols-[110px_1fr] gap-y-1.5 text-[12.5px]">
          <dt className="text-neutral-600">version</dt>
          <dd className="m-0 tabular-nums">{versionLine(status)}</dd>
          <dt className="text-neutral-600">last run</dt>
          <dd className="m-0">{lastRunLine(status.last)}</dd>
        </dl>
        {error && (
          <p className="border-l-2 border-alarm bg-alarm/10 px-3 py-2 text-[12px] text-alarm">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={running} onClick={now}>
            {running ? "Updating…" : "Update now"}
          </Button>
          {status.mode === "repo" && (
            <span className="text-[11px] text-neutral-600">
              waits if this clone has uncommitted changes
            </span>
          )}
        </div>
      </div>
    </Panel>
  );
}

const ATTENTION_LABELS: Record<string, string> = {
  refusals: "A hook blocked a call, or you denied one",
  waiting: "A handoff left a question for you",
  unranked: "A project has no purpose on record",
};

const THRESHOLDS = [
  { key: "quietAfterDays", label: 'a project is "gone quiet" after' },
  { key: "urgentWithinDays", label: "a dated step is urgent within" },
] as const;

function Ranking({ initial }: { initial: ControlRoomPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const save = (update: Record<string, unknown>) => {
    void writePrefs(update).then((failure) => {
      setError(failure);
      if (!failure) setPrefs({ ...prefs, ...update } as ControlRoomPrefs);
    });
  };

  return (
    <>
      <Panel title="Ranking">
        <div className="flex flex-col gap-4">
          {THRESHOLDS.map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <Label>{label}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  className="w-20"
                  value={prefs[key]}
                  onChange={(e) => {
                    const days = Number(e.target.value);
                    setPrefs({ ...prefs, [key]: days });
                    if (Number.isInteger(days) && days > 0) save({ [key]: days });
                  }}
                />
                <span className="text-[12px] text-neutral-700">days</span>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-divider pt-3 text-[12.5px]">
            <span>rank stated goals in the grid, not just projects</span>
            <Switch
              aria-label="rank stated goals in the grid"
              checked={prefs.rankGoals}
              onCheckedChange={(rankGoals) => save({ rankGoals })}
            />
          </div>
          {error && (
            <p className="border-l-2 border-alarm bg-alarm/10 px-3 py-2 text-[12px] text-alarm">
              {error}
            </p>
          )}
        </div>
      </Panel>
      <Panel title="Attention">
        <p className="mb-3 text-[12px] text-neutral-700">
          What lights the bell. Each source is a fact PAL already holds — nothing here
          asks a model.
        </p>
        <div className="flex flex-col">
          {Object.entries(prefs.attention).map(([source, on]) => (
            <div
              key={source}
              className="flex items-center justify-between gap-3 border-t border-divider py-2.5 text-[12.5px] first:border-t-0"
            >
              <span>{ATTENTION_LABELS[source] ?? source}</span>
              <Switch
                aria-label={ATTENTION_LABELS[source] ?? source}
                checked={on}
                onCheckedChange={(next) => save({ attention: { [source]: next } })}
              />
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

export function Settings() {
  const settings = useLoaded<InstallSettings>("/api/settings");
  const prefs = useLoaded<ControlRoomPrefs>("/api/prefs");
  const status = useLoaded<ServerStatus>("/api/status");
  const updates = useLoaded<AutoUpdateStatus>("/api/update");

  if (settings.state !== "ready") return <Pending value={settings} />;
  return (
    <div className="grid items-start gap-6 md:grid-cols-2">
      <ThisInstall initial={settings.data} />
      {prefs.state === "ready" && <Ranking initial={prefs.data} />}
      {updates.state === "ready" && <Updates initial={updates.data} />}
      <Panel title="Where it runs">
        {status.state === "ready" ? (
          <dl className="m-0 grid grid-cols-[110px_1fr] gap-y-1.5 text-[12.5px]">
            <dt className="text-neutral-600">machine</dt>
            <dd className="m-0">{status.data.machine}</dd>
            <dt className="text-neutral-600">port</dt>
            <dd className="m-0 tabular-nums">{status.data.port}</dd>
            <dt className="text-neutral-600">pid</dt>
            <dd className="m-0 tabular-nums">{status.data.pid}</dd>
            <dt className="text-neutral-600">ledger</dt>
            <dd className="m-0">{status.data.ledgerFiles} file(s)</dd>
            <dt className="text-neutral-600">up since</dt>
            <dd className="m-0">{status.data.startedAt}</dd>
          </dl>
        ) : (
          <Empty>not answering</Empty>
        )}
        <p className="mt-3 text-[11px] text-neutral-600">
          Loopback only. The machine label is set with <code>pal cli machine</code>, and
          stays on this machine.
        </p>
      </Panel>
    </div>
  );
}
