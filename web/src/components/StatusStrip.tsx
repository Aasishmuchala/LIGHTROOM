"use client";

// StatusStrip — a single calm line under the command bar that answers "where am I?"
// at a glance: the current stage of the flow on the left, and once re-renders are
// logged, the live best-match read-out on the right (with a green pilot lamp when the
// lighting is measured-matched). Purely derived from engine state; no logic here.

import { useEngine } from "@/store/useEngine";
import { matchPercent, MATCH_THRESHOLD } from "@/lib/metrics";

const STAGES = [
  { key: "frames", label: "Frames" },
  { key: "scene", label: "Scene" },
  { key: "analyze", label: "Analyze" },
  { key: "refine", label: "Refine" },
] as const;

export function StatusStrip() {
  const state = useEngine((s) => s.state());
  const chain = useEngine((s) => s.activeChain());
  const inFlight = useEngine((s) => !!s._inFlight);

  const hasRecipe = !!(chain && chain.recipe);
  const attempts = chain?.attempts ?? [];

  // Which stage is "current" — the leftmost unfinished one.
  const activeStage: (typeof STAGES)[number]["key"] =
    state === "empty" ? "frames" : !hasRecipe ? "analyze" : "refine";
  const activeIdx = STAGES.findIndex((s) => s.key === activeStage);

  // Live best-match read-out (only meaningful once a re-render is scored).
  const best =
    attempts.length > 0
      ? attempts.reduce((b, a) => (a.score < b.score ? a : b), attempts[0])
      : null;
  const bestPct = best ? matchPercent(best.score) : null;
  const matched = best ? best.score <= MATCH_THRESHOLD : false;

  const hint = inFlight
    ? "Reading the light…"
    : state === "empty"
      ? "Add a reference and a base render to begin."
      : state === "ready"
        ? "Ready — press Analyze."
        : "Recipe ready — apply it, re-render, drop the result into Refine.";

  return (
    <div className="status-strip">
      <ol className="status-stages" aria-label="Workflow stage">
        {STAGES.map((s, i) => {
          const done = i < activeIdx;
          const current = i === activeIdx;
          return (
            <li
              key={s.key}
              className="status-stage"
              data-state={current ? "current" : done ? "done" : "todo"}
            >
              <span className="status-stage-dot" aria-hidden />
              <span className="status-stage-label">{s.label}</span>
              {i < STAGES.length - 1 && <span className="status-stage-sep" aria-hidden />}
            </li>
          );
        })}
      </ol>

      <div className="status-read">
        {bestPct !== null ? (
          <>
            <span className={`lamp ${matched ? "lamp-green" : ""}`} aria-hidden />
            <span className="status-read-pct tabular-nums">{bestPct}%</span>
            <span className="status-read-sub">
              best · {attempts.length} attempt{attempts.length === 1 ? "" : "s"}
            </span>
          </>
        ) : (
          <span className="status-read-hint">{hint}</span>
        )}
      </div>
    </div>
  );
}

export default StatusStrip;
