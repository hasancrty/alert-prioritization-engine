import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  initialState,
  tick,
  generateAlerts,
  prioritize,
  formatClock,
  type FlightState,
  type ScoredAlert,
  type AlertLevel,
} from "@/lib/simulation";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Alert Prioritization Engine — AI-Assisted Cockpit Alerting" },
      {
        name: "description",
        content:
          "Real-time multi-source cockpit alert prioritization engine. Fuses TCAS, EGPWS, weather radar, fuel and systems alerts, scores them by severity and urgency, and suppresses low-priority noise to reduce pilot workload.",
      },
      { property: "og:title", content: "Alert Prioritization Engine" },
      {
        property: "og:description",
        content:
          "AI-assisted cockpit alert prioritization: severity scoring, threat correlation and workload-reducing suppression over a live flight simulation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const LEVEL_STYLE: Record<AlertLevel, string> = {
  WARNING: "border-destructive/60 bg-destructive/10 text-destructive",
  CAUTION: "border-amber-500/60 bg-amber-500/10 text-amber-400",
  ADVISORY: "border-sky-500/50 bg-sky-500/10 text-sky-400",
};

const LEVEL_DOT: Record<AlertLevel, string> = {
  WARNING: "bg-destructive",
  CAUTION: "bg-amber-400",
  ADVISORY: "bg-sky-400",
};

function Index() {
  const [state, setState] = useState<FlightState>(initialState);
  const [alerts, setAlerts] = useState<ScoredAlert[]>([]);
  const [running, setRunning] = useState(true);
  const [showSuppressed, setShowSuppressed] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const next = tick(stateRef.current, 1);
      stateRef.current = next;
      setState(next);
      setAlerts(prioritize(generateAlerts(next, stateRef.current), next));
    }, 500);
    return () => clearInterval(id);
  }, [running]);

  const visible = alerts.filter((a) => !a.suppressed);
  const suppressed = alerts.filter((a) => a.suppressed);
  const top = visible[0];

  return (
    <div className="min-h-screen bg-background font-mono text-foreground">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold tracking-widest text-primary">
              ALERT PRIORITIZATION ENGINE
            </h1>
            <p className="text-xs text-muted-foreground">
              AI-assisted multi-source cockpit alerting · pilot workload reduction
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              T+{formatClock(state.timeSec)}
            </span>
            <button
              onClick={() => setRunning((r) => !r)}
              className="rounded border border-border bg-secondary px-3 py-1 text-xs tracking-wider text-secondary-foreground hover:bg-accent"
            >
              {running ? "⏸ PAUSE SIM" : "▶ RESUME SIM"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 p-6 lg:grid-cols-3">
        {/* Flight state panel */}
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-bold tracking-widest text-muted-foreground">
            FLIGHT STATE
          </h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="PHASE" value={state.phase} accent />
            <Stat label="ALT" value={`${Math.round(state.altitudeFt).toLocaleString()} ft`} />
            <Stat label="IAS" value={`${Math.round(state.airspeedKts)} kts`} />
            <Stat label="HDG" value={`${Math.round(state.headingDeg)}°`} />
            <Stat label="V/S" value={`${Math.round(state.verticalSpeedFpm)} fpm`} />
            <Stat label="FUEL" value={`${Math.round(state.fuelKg).toLocaleString()} kg`} />
            <Stat label="DEST" value={`${Math.round(state.distanceToDestNm)} nm`} />
            <Stat label="TRAFFIC" value={`${state.trafficCount} contacts`} />
            <Stat
              label="TERRAIN CLR"
              value={`${Math.round(state.terrainClearanceFt)} ft`}
              warn={state.terrainClearanceFt < 1000}
            />
            <Stat
              label="WX SEVERITY"
              value={`${state.weatherSeverity.toFixed(1)} / 10`}
              warn={state.weatherSeverity >= 7}
            />
          </div>

          {/* Workload meter */}
          <div className="mt-5">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>CREW ALERT LOAD</span>
              <span>
                {visible.length} shown · {suppressed.length} suppressed
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-secondary">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${Math.min(100, visible.length * 18)}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              The engine ranks every active alert by severity, time-to-impact and
              flight-phase relevance, then suppresses low-priority noise while a
              WARNING is active — so the crew only sees what matters now.
            </p>
          </div>
        </section>

        {/* Prioritized alert stack */}
        <section className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold tracking-widest text-muted-foreground">
              PRIORITIZED ALERT STACK
            </h2>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showSuppressed}
                onChange={(e) => setShowSuppressed(e.target.checked)}
                className="accent-current"
              />
              show suppressed ({suppressed.length})
            </label>
          </div>

          {visible.length === 0 && (
            <div className="flex h-40 items-center justify-center rounded border border-dashed border-border text-sm text-muted-foreground">
              NO ACTIVE ALERTS — ALL SYSTEMS NOMINAL
            </div>
          )}

          <ul className="space-y-2">
            {(showSuppressed ? alerts : visible).map((a) => (
              <li
                key={a.id}
                className={`rounded-md border p-3 ${LEVEL_STYLE[a.level]} ${
                  a.suppressed ? "opacity-40" : ""
                } ${top?.id === a.id ? "ring-1 ring-current" : ""}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center text-xs font-bold">
                      #{a.rank}
                    </span>
                    <span
                      className={`h-2 w-2 rounded-full ${LEVEL_DOT[a.level]} ${
                        a.level === "WARNING" ? "animate-pulse" : ""
                      }`}
                    />
                    <div>
                      <div className="text-sm font-bold tracking-wide">
                        {a.message}
                      </div>
                      <div className="text-[11px] opacity-70">
                        {a.source} · {a.code}
                        {a.timeToImpactSec !== undefined &&
                          ` · TTI ${Math.round(a.timeToImpactSec)}s`}
                        {a.correlatedWith && a.correlatedWith.length > 0 &&
                          ` · correlated ×${a.correlatedWith.length}`}
                        {a.suppressed && " · SUPPRESSED"}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold">{a.score}</div>
                    <div className="text-[10px] opacity-70">SEVERITY</div>
                  </div>
                </div>
                <div className="mt-2 flex gap-3 text-[10px] opacity-60">
                  <span>base {a.scoreBreakdown.levelBase}</span>
                  <span>urgency +{a.scoreBreakdown.urgency}</span>
                  <span>phase +{a.scoreBreakdown.phaseRelevance}</span>
                  <span>correlation +{a.scoreBreakdown.correlationBonus}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-3 text-center text-[11px] text-muted-foreground">
        Simulation for research/demo purposes — not certified flight software.
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded border border-border bg-secondary/50 px-3 py-2">
      <div className="text-[10px] tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        className={`text-sm font-bold ${
          warn ? "text-destructive" : accent ? "text-primary" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
