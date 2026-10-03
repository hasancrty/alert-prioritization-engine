// ============================================================
// Alert Prioritization Engine — core simulation & scoring logic
// Simulates multi-source cockpit alerts (TCAS, EGPWS, weather,
// fuel, systems, traffic) and ranks them by a severity score so
// the crew always sees the most critical alert first.
// ============================================================

export type AlertSource =
  | "TCAS"
  | "EGPWS"
  | "WXR" // weather radar
  | "FUEL"
  | "SYS" // aircraft systems
  | "ATC";

export type AlertLevel = "WARNING" | "CAUTION" | "ADVISORY";

export interface FlightState {
  timeSec: number; // simulation clock
  altitudeFt: number;
  airspeedKts: number;
  headingDeg: number;
  verticalSpeedFpm: number;
  fuelKg: number;
  fuelFlowKgH: number;
  distanceToDestNm: number;
  trafficCount: number;
  terrainClearanceFt: number;
  weatherSeverity: number; // 0..10 ahead on route
  phase: FlightPhase;
}

export type FlightPhase =
  | "CLIMB"
  | "CRUISE"
  | "DESCENT"
  | "APPROACH";

export interface RawAlert {
  id: string;
  source: AlertSource;
  code: string;
  message: string;
  level: AlertLevel;
  raisedAt: number;
  // sensor context used by the scorer
  timeToImpactSec?: number; // e.g. TCAS RA time-to-collision
  requiresImmediateAction: boolean;
  correlatedWith?: string[]; // ids of related alerts
}

export interface ScoredAlert extends RawAlert {
  score: number; // 0..100
  rank: number;
  scoreBreakdown: {
    levelBase: number;
    urgency: number;
    phaseRelevance: number;
    correlationBonus: number;
  };
  suppressed: boolean; // low-priority duplicates hidden from crew
}

// ---------- alert catalogue ----------

interface AlertTemplate {
  source: AlertSource;
  code: string;
  message: string;
  level: AlertLevel;
  requiresImmediateAction: boolean;
  trigger: (s: FlightState) => boolean;
  timeToImpact?: (s: FlightState) => number;
}

const TEMPLATES: AlertTemplate[] = [
  {
    source: "TCAS",
    code: "TCAS-RA",
    message: "RESOLUTION ADVISORY — CLIMB, CLIMB",
    level: "WARNING",
    requiresImmediateAction: true,
    trigger: (s) => s.trafficCount >= 3 && s.phase === "CRUISE",
    timeToImpact: () => 25 + Math.random() * 15,
  },
  {
    source: "TCAS",
    code: "TCAS-TA",
    message: "TRAFFIC ADVISORY — TRAFFIC 2 O'CLOCK",
    level: "CAUTION",
    requiresImmediateAction: false,
    trigger: (s) => s.trafficCount >= 2,
    timeToImpact: () => 45 + Math.random() * 30,
  },
  {
    source: "EGPWS",
    code: "EGPWS-TERR",
    message: "TERRAIN AHEAD, PULL UP",
    level: "WARNING",
    requiresImmediateAction: true,
    trigger: (s) => s.terrainClearanceFt < 1000 && s.phase !== "CRUISE",
    timeToImpact: (s) => Math.max(10, s.terrainClearanceFt / 60),
  },
  {
    source: "EGPWS",
    code: "EGPWS-SINK",
    message: "SINK RATE — SINK RATE",
    level: "CAUTION",
    requiresImmediateAction: false,
    trigger: (s) => s.verticalSpeedFpm < -1800 && s.altitudeFt < 10000,
    timeToImpact: (s) => Math.abs(s.altitudeFt / s.verticalSpeedFpm) * 60,
  },
  {
    source: "WXR",
    code: "WXR-CELL",
    message: "SEVERE CONVECTIVE CELL ON ROUTE — DEVIATE",
    level: "CAUTION",
    requiresImmediateAction: false,
    trigger: (s) => s.weatherSeverity >= 7,
  },
  {
    source: "WXR",
    code: "WXR-WINDSHEAR",
    message: "WINDSHEAR AHEAD — WINDSHEAR AHEAD",
    level: "WARNING",
    requiresImmediateAction: true,
    trigger: (s) => s.weatherSeverity >= 9 && s.phase === "APPROACH",
    timeToImpact: () => 20 + Math.random() * 20,
  },
  {
    source: "FUEL",
    code: "FUEL-LOW",
    message: "FUEL BELOW MINIMUM RESERVE",
    level: "CAUTION",
    requiresImmediateAction: false,
    trigger: (s) => s.fuelKg < 1200,
  },
  {
    source: "FUEL",
    code: "FUEL-IMBAL",
    message: "FUEL IMBALANCE BETWEEN TANKS",
    level: "ADVISORY",
    requiresImmediateAction: false,
    trigger: (s) => s.timeSec % 90 < 30 && s.fuelKg < 4000,
  },
  {
    source: "SYS",
    code: "SYS-HYD",
    message: "HYD B SYSTEM PRESSURE LOW",
    level: "CAUTION",
    requiresImmediateAction: false,
    trigger: (s) => s.timeSec > 120 && s.timeSec % 150 < 40,
  },
  {
    source: "SYS",
    code: "SYS-CABIN",
    message: "CABIN ALTITUDE RISING",
    level: "WARNING",
    requiresImmediateAction: true,
    trigger: (s) => s.altitudeFt > 30000 && s.timeSec % 200 < 25,
    timeToImpact: () => 60 + Math.random() * 60,
  },
  {
    source: "ATC",
    code: "ATC-HDG",
    message: "ATC: TURN LEFT HDG 270 DUE TRAFFIC",
    level: "ADVISORY",
    requiresImmediateAction: false,
    trigger: (s) => s.trafficCount >= 1 && s.timeSec % 60 < 20,
  },
  {
    source: "SYS",
    code: "SYS-ENG-VIB",
    message: "ENG 2 VIBRATION ABOVE NORMAL",
    level: "ADVISORY",
    requiresImmediateAction: false,
    trigger: (s) => s.timeSec % 110 < 25,
  },
];

// ---------- scoring engine ----------

const LEVEL_BASE: Record<AlertLevel, number> = {
  WARNING: 55,
  CAUTION: 32,
  ADVISORY: 14,
};

// Higher stakes phases amplify alert relevance (approach = busiest).
const PHASE_WEIGHT: Record<FlightPhase, number> = {
  CLIMB: 0.9,
  CRUISE: 0.7,
  DESCENT: 1.0,
  APPROACH: 1.2,
};

export function scoreAlert(alert: RawAlert, state: FlightState): ScoredAlert {
  const levelBase = LEVEL_BASE[alert.level];

  // Urgency: closer to impact -> higher score, saturates at 30 pts.
  let urgency = 0;
  if (alert.timeToImpactSec !== undefined) {
    urgency = Math.max(0, 30 * (1 - alert.timeToImpactSec / 120));
  } else if (alert.requiresImmediateAction) {
    urgency = 18;
  }

  const phaseRelevance = 10 * PHASE_WEIGHT[state.phase];

  const correlationBonus = (alert.correlatedWith?.length ?? 0) * 4;

  const score = Math.min(
    100,
    Math.round(levelBase + urgency + phaseRelevance + correlationBonus)
  );

  return {
    ...alert,
    score,
    rank: 0,
    scoreBreakdown: { levelBase, urgency: Math.round(urgency), phaseRelevance: Math.round(phaseRelevance), correlationBonus },
    suppressed: false,
  };
}

// Rank + suppress: alerts below threshold while a WARNING is active get
// suppressed to reduce pilot workload (the core value proposition).
export function prioritize(alerts: RawAlert[], state: FlightState): ScoredAlert[] {
  // correlate alerts from different sources about the same threat
  const correlated = alerts.map((a) => ({
    ...a,
    correlatedWith: alerts
      .filter((b) => b.id !== a.id && relatedThreat(a, b))
      .map((b) => b.id),
  }));

  const scored = correlated.map((a) => scoreAlert(a, state));
  scored.sort((a, b) => b.score - a.score);

  const hasWarning = scored.some((a) => a.level === "WARNING");
  scored.forEach((a, i) => {
    a.rank = i + 1;
    a.suppressed = hasWarning && a.level === "ADVISORY" && a.score < 30;
  });

  return scored;
}

function relatedThreat(a: RawAlert, b: RawAlert): boolean {
  const trafficPair = (x: RawAlert, y: RawAlert) =>
    x.source === "TCAS" && y.source === "ATC";
  const terrainPair = (x: RawAlert, y: RawAlert) =>
    x.source === "EGPWS" && y.code === "WXR-WINDSHEAR";
  return trafficPair(a, b) || trafficPair(b, a) || terrainPair(a, b) || terrainPair(b, a);
}

// ---------- flight simulation ----------

export function initialState(): FlightState {
  return {
    timeSec: 0,
    altitudeFt: 12000,
    airspeedKts: 280,
    headingDeg: 90,
    verticalSpeedFpm: 1800,
    fuelKg: 5200,
    fuelFlowKgH: 2400,
    distanceToDestNm: 420,
    trafficCount: 0,
    terrainClearanceFt: 6000,
    weatherSeverity: 2,
    phase: "CLIMB",
  };
}

export function tick(state: FlightState, dtSec: number): FlightState {
  const s = { ...state, timeSec: state.timeSec + dtSec };

  // simple scripted profile: climb to FL350, cruise, descend, approach
  if (s.phase === "CLIMB") {
    s.altitudeFt += 30 * dtSec;
    if (s.altitudeFt >= 35000) {
      s.altitudeFt = 35000;
      s.phase = "CRUISE";
      s.verticalSpeedFpm = 0;
    }
  } else if (s.phase === "CRUISE") {
    s.distanceToDestNm -= (s.airspeedKts / 3600) * dtSec;
    if (s.distanceToDestNm < 80) {
      s.phase = "DESCENT";
      s.verticalSpeedFpm = -1500;
    }
  } else if (s.phase === "DESCENT") {
    s.altitudeFt = Math.max(3000, s.altitudeFt - 25 * dtSec);
    s.distanceToDestNm -= (s.airspeedKts / 3600) * dtSec;
    if (s.altitudeFt <= 3000) {
      s.phase = "APPROACH";
      s.verticalSpeedFpm = -700;
    }
  } else {
    s.altitudeFt = Math.max(800, s.altitudeFt - 12 * dtSec);
  }

  // fuel burn
  s.fuelKg = Math.max(300, s.fuelKg - (s.fuelFlowKgH / 3600) * dtSec);

  // ambient variation (deterministic-ish noise via sine mix)
  const t = s.timeSec;
  s.trafficCount = Math.max(
    0,
    Math.round(2.5 + 2.5 * Math.sin(t / 37) + (t % 211 < 30 ? 2 : 0))
  );
  s.terrainClearanceFt =
    s.phase === "APPROACH" || s.phase === "DESCENT"
      ? Math.max(400, s.altitudeFt - 1800 + 900 * Math.sin(t / 23))
      : 6000 + 1500 * Math.sin(t / 41);
  s.weatherSeverity = Math.min(
    10,
    Math.max(0, 4 + 4 * Math.sin(t / 53) + (t % 307 < 40 ? 3 : 0))
  );
  s.headingDeg = (s.headingDeg + 0.2 * Math.sin(t / 17)) % 360;

  return s;
}

let alertSeq = 0;

export function generateAlerts(state: FlightState, prev: FlightState): RawAlert[] {
  const active: RawAlert[] = [];
  for (const tpl of TEMPLATES) {
    if (tpl.trigger(state)) {
      active.push({
        id: `${tpl.code}-${Math.floor(state.timeSec / 10)}`,
        source: tpl.source,
        code: tpl.code,
        message: tpl.message,
        level: tpl.level,
        raisedAt: state.timeSec,
        requiresImmediateAction: tpl.requiresImmediateAction,
        ...(tpl.timeToImpact ? { timeToImpactSec: tpl.timeToImpact(state) } : {}),
      });
    }
  }
  // stable ids across ticks of the same 10s window
  void prev;
  void alertSeq;
  return active;
}

export function formatClock(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
