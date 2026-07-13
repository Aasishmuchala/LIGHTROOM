// LightMatch expert-chat context builders — PURE (no DOM, no network), node-testable.
//
// Two jobs:
//   - sessionDigest(...): fold the live session into a compact, deterministic text
//     block the /api/chat system prompt carries, so the expert model answers with
//     full awareness of the user's actual state (target, recipe moves, attempt
//     scores, probe, live 3ds Max pull) without shipping the images again.
//   - checkinEvidence(...): when the user drops a fresh render INTO the chat, run
//     the SAME deterministic photometry the analyze loop trusts (diffVectors /
//     scoreVectors / wbExposureEvidence / sceneEvidence) and emit a lean evidence
//     text block + the measured score, so the model's confirm/re-edit verdict is
//     grounded in measured numbers, never vibes. Lean by design: the full metric
//     objects blow omega's ~100s wall clock (see client-adapter's legend notes);
//     the diff + derived scalars are what the correction path already ships.
//
// Both functions read structural mini-types (not the engine's own interfaces) so
// tests can feed plain objects and this module never imports React/zustand.

import {
  diffVectors,
  scoreVectors,
  matchPercent,
  wbExposureEvidence,
  sceneEvidence,
  MATCH_THRESHOLD,
} from "./metrics";
import { PACKS } from "./packs";
import type { MetricVector } from "./types";

// ---------------------------------------------------------------------------
// Structural inputs (narrow mirrors of the engine's Session/Chain — see
// store/useEngine.ts; every field optional-guarded because persisted sessions
// from older versions lack the newer ones).
// ---------------------------------------------------------------------------
export interface DigestRecipeValue {
  param?: unknown;
  from?: unknown;
  set?: unknown;
  step?: unknown;
  why?: unknown;
}
export interface DigestChain {
  recipe?: { values?: DigestRecipeValue[]; baseline?: string; status?: string } | null;
  attempts?: Array<{ score?: number; correction?: { status?: string } | null }>;
  _attemptCount?: number;
  recipeApplied?: Record<string, boolean> | null;
  probe?: {
    param?: string;
    from?: number | string;
    to?: number | string;
    response?: { d_ev?: number | null } | null;
  } | null;
}
export interface DigestSession {
  context?: Record<string, string>;
  ref?: unknown;
  base?: unknown;
  activeTarget?: string;
  chains?: Record<string, DigestChain | undefined>;
  liveSettings?: { renderer?: string; params?: Record<string, number | string> } | null;
}

// Caps — the digest is a system-prompt tenant, not a dump. -------------------------
export const DIGEST_MOVES_CAP = 16;
export const DIGEST_ATTEMPTS_CAP = 4;
export const DIGEST_LIVE_PARAMS_CAP = 12;
export const DIGEST_MAX_CHARS = 6000;

const r2 = (v: number) => Math.round(v * 100) / 100;
const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);

function targetLabel(target: string): string {
  const packs = PACKS as unknown as Record<string, { label?: string } | undefined>;
  return packs[target]?.label || target;
}

// -- sessionDigest(session): the deterministic "where the user actually is" block. --
export function sessionDigest(session: DigestSession | null | undefined): string {
  if (!session) return "SESSION DIGEST: no session yet — the user has not loaded any frames.";
  const target = typeof session.activeTarget === "string" ? session.activeTarget : "vray7max";
  const chain = session.chains ? session.chains[target] : undefined;
  const hasRef = !!session.ref;
  const hasBase = !!session.base;
  const recipe = chain?.recipe || null;
  const attempts = Array.isArray(chain?.attempts) ? chain.attempts : [];

  const lines: string[] = [];
  lines.push("SESSION DIGEST — the user's ACTUAL current state in the app (deterministic):");
  lines.push(`- target renderer: ${targetLabel(target)} [${target}]`);

  const stage = !hasRef || !hasBase
    ? `inputs pending (reference ${hasRef ? "loaded" : "missing"}, base render ${hasBase ? "loaded" : "missing"})`
    : !recipe
      ? "ready — both frames loaded, not analyzed yet"
      : attempts.length
        ? `refining — recipe issued, ${attempts.length} attempt(s) logged`
        : "analyzed — recipe issued, no re-render logged yet";
  lines.push(`- stage: ${stage}`);

  const ctx = session.context || {};
  const chips = Object.entries(ctx)
    .filter(([, v]) => typeof v === "string" && v !== "")
    .map(([k, v]) => `${k}: ${clip(v, 40)}`)
    .join(", ");
  if (chips) lines.push(`- scene context: ${chips}`);

  if (recipe && Array.isArray(recipe.values)) {
    const applied = chain?.recipeApplied || null;
    const values = recipe.values.filter((v) => v && typeof v.param === "string");
    const appliedCount = applied
      ? values.filter((v) => applied[v.param as string] !== false).length
      : values.length;
    lines.push(
      `- recipe: ${values.length} move(s) (baseline: ${recipe.baseline === "settings_screenshot" ? "live/screenshot settings" : "factory defaults"}); marked applied: ${appliedCount}/${values.length}`
    );
    for (const v of values.slice(0, DIGEST_MOVES_CAP)) {
      const entry = PACKS.lookup(target, v.param as string);
      const path = entry ? entry.ui_path : (v.param as string);
      const flag = applied && applied[v.param as string] === false ? " (user skipped)" : "";
      lines.push(`    ${clip(path, 90)}: ${clip(v.from, 24)} -> ${clip(v.set, 24)}${flag}`);
    }
    if (values.length > DIGEST_MOVES_CAP) {
      lines.push(`    … and ${values.length - DIGEST_MOVES_CAP} more move(s) not listed.`);
    }
  }

  if (attempts.length) {
    const recent = attempts.slice(-DIGEST_ATTEMPTS_CAP);
    const firstN = (chain?._attemptCount ?? attempts.length) - (attempts.length - 1);
    const parts = recent.map((a, i) => {
      const n = firstN + (attempts.length - recent.length) + i;
      const s = typeof a.score === "number" && Number.isFinite(a.score) ? a.score : null;
      return s === null ? `#${n} unscored` : `#${n} look ${r2(s)} (${matchPercent(s)}%)`;
    });
    const scores = attempts
      .map((a) => a.score)
      .filter((s): s is number => typeof s === "number" && Number.isFinite(s));
    const best = scores.length ? Math.min(...scores) : null;
    lines.push(
      `- attempts: ${parts.join(", ")}${best !== null ? ` — best ${matchPercent(best)}%` : ""} (lighting counts as MATCHED at look distance <= ${MATCH_THRESHOLD}, i.e. ${matchPercent(MATCH_THRESHOLD)}%+)`
    );
    const lastStatus = attempts[attempts.length - 1]?.correction?.status;
    if (typeof lastStatus === "string" && lastStatus) lines.push(`- last correction status: ${clip(lastStatus, 60)}`);
  }

  const probe = chain?.probe;
  if (probe && typeof probe.param === "string") {
    const resp = probe.response;
    lines.push(
      `- calibration probe: ${probe.param} ${clip(probe.from, 24)} -> ${clip(probe.to, 24)}${resp && typeof resp.d_ev === "number" ? ` measured d_ev ${r2(resp.d_ev)} EV` : " (armed, not rendered yet)"}`
    );
  }

  const live = session.liveSettings;
  if (live && live.params && Object.keys(live.params).length) {
    const rows = Object.entries(live.params)
      .slice(0, DIGEST_LIVE_PARAMS_CAP)
      .map(([k, v]) => `${clip(k, 40)}=${clip(v, 40)}`)
      .join(", ");
    lines.push(
      `- LIVE 3ds Max pull (renderer: ${clip(live.renderer || "unknown", 60)}): ${rows}${Object.keys(live.params).length > DIGEST_LIVE_PARAMS_CAP ? ", …" : ""} — these are ground-truth current values.`
    );
  }

  return lines.join("\n").slice(0, DIGEST_MAX_CHARS);
}

// ---------------------------------------------------------------------------
// checkinEvidence(refMetrics, currentMetrics): measured verdict material for a
// render dropped into the chat. diff orientation matches the analyze loop:
// diffVectors(current, ref) = reference − current (positive ⇒ move that way).
// ---------------------------------------------------------------------------
export interface CheckinEvidence {
  score: number;
  matchPercent: number;
  matched: boolean;
  text: string;
}

const round4 = (_k: string, v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v;

export function checkinEvidence(refM: MetricVector, curM: MetricVector): CheckinEvidence {
  const score = scoreVectors(refM, curM);
  const pct = matchPercent(score);
  const matched = score <= MATCH_THRESHOLD;
  const bundle = {
    diff: diffVectors(curM, refM),
    ...wbExposureEvidence(refM, curM),
    ...sceneEvidence(refM, curM),
  };
  const text =
    `CHECK-IN EVIDENCE — deterministic photometry of the render the user just dropped, vs the reference ` +
    `(same pipeline the recipe used; diff = reference − current, positive means move that way; luminance is ` +
    `linear 0-1; exposure_gap_ev in stops, positive = current render too dark; wb_estimate_k = measured CCT, ` +
    `lower kelvin = warmer image): look_distance=${r2(score)} — lighting is MATCHED at <= ${MATCH_THRESHOLD} ` +
    `(this render: ${pct}% match, ${matched ? "MATCHED — remaining gap is a color grade, not lighting" : "not matched yet"}). ` +
    JSON.stringify(bundle, round4);
  return { score, matchPercent: pct, matched, text };
}

const chatDigest = { sessionDigest, checkinEvidence };
export default chatDigest;
