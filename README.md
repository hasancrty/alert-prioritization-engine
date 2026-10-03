# Alert Prioritization Engine

AI-assisted, multi-source cockpit alert prioritization engine designed to **reduce pilot workload** during high-stakes flight phases.

## Overview

Modern cockpits can generate dozens of simultaneous alerts from independent systems (TCAS, EGPWS, weather radar, fuel, hydraulics, ATC). Raw alert floods increase crew workload exactly when cognitive capacity is lowest. This project implements a **severity-scoring and suppression engine** that:

- **Fuses** alerts from multiple avionics sources in real time
- **Scores** each alert (0–100) using:
  - alert level base weight (WARNING / CAUTION / ADVISORY)
  - time-to-impact urgency (e.g. TCAS RA time-to-collision)
  - flight-phase relevance (approach amplifies scores)
  - cross-source threat correlation (e.g. TCAS + ATC about the same traffic)
- **Ranks** all active alerts into a single prioritized stack
- **Suppresses** low-priority advisories while a WARNING is active, cutting alert noise

## Live Simulation

The included dashboard runs a scripted flight profile (climb → cruise → descent → approach) with evolving traffic, terrain clearance and weather severity. Alerts are generated from sensor-like triggers, scored, ranked and displayed with a full score breakdown.

## Tech Stack

- **React 19 + TanStack Start** (SSR, file-based routing)
- **TypeScript** — strict typed simulation & scoring engine
- **Tailwind CSS v4** — dark cockpit UI

## Project Structure

```
src/lib/simulation.ts   # flight model, alert catalogue, scoring & suppression engine
src/routes/index.tsx    # live dashboard (flight state, alert stack, crew load meter)
```

## Scoring Model

```
score = levelBase + urgency + phaseRelevance + correlationBonus   (capped at 100)
```

| Component          | Range  | Rationale                                        |
| ------------------ | ------ | ------------------------------------------------ |
| levelBase          | 14–55  | WARNING > CAUTION > ADVISORY                     |
| urgency            | 0–30   | Saturates as time-to-impact → 0                  |
| phaseRelevance     | 7–12   | Approach/departure phases demand faster response |
| correlationBonus   | +4/src | Multiple sources confirming one threat           |

Alerts below threshold are **suppressed** while any WARNING is active, directly reducing the number of items the crew must process.

## Running Locally

```bash
bun install
bun run dev
```

## Disclaimer

Research/demonstration software — not certified for operational aviation use.
