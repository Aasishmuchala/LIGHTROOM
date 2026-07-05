"use client";

import { engineStore, useEngine } from "@/store/useEngine";
import type { AttemptEntry } from "@/store/useEngine";
import type { TargetId } from "@/lib/types";
import { PACKS } from "@/lib/packs";
import { MATCH_THRESHOLD } from "@/lib/metrics";
import { PathBreadcrumb, ConfDot, ValueJewel, ClampedFlag } from "./bits";
import { safeSrc, copyText } from "./lib";

// The refine loop: correction cards (deltas) with the look-distance score + trend,
// a filmstrip of reference + attempts, the caveat, and the REFGRADE handoff banner
// (only from structured status === "handoff_to_grade"). ----------------------------
export function RefineLedger({ onToast }: { onToast: (m: string) => void }) {
  const session = useEngine((s) => s.session);
  const chain = useEngine((s) => s.activeChain());
  const target = session.activeTarget as TargetId;

  const attempts = chain?.attempts || [];
  if (!session.ref || attempts.length === 0) return null;

  // The number the product promises: the % match of the CLOSEST (lowest look-distance)
  // attempt so far. This is the measured truth the whole panel is gated on.
  const closest = attempts.reduce(
    (best, a) => (a.score < best.score ? a : best),
    attempts[0]
  );
  // SINGLE source of truth for the display. Round look-distance ONCE, then derive BOTH
  // the % match and the prose from the rounded integer. Previously the % came from
  // matchPercent(rawScore) and the look-distance came from Math.round(rawScore) — two
  // independent roundings of the same float that don't reconcile (e.g. score 2.4 → 98%
  // and "look dist 2", score 2.6 → 98% and "look dist 3"). The user reads "98% / look dist 2"
  // then "98% / look dist 3" with no value change as "values are random". Rounding once
  // collapses the wobble: 98% ↔ 2, 99% ↔ 1, 100% ↔ 0.
  const bestScore = closest.score;
  const bestScoreRounded = Math.round(bestScore);
  const bestPercent = Math.max(0, Math.min(100, 100 - bestScoreRounded));
  // MEASURED gate stays on the raw score: 2.6 is genuinely matched even though the
  // rounded display reads "98% / look dist 3". The gate trusts the measurement;
  // the display rounds for legibility.
  const measuredMatched = bestScore <= MATCH_THRESHOLD;

  // Did the model SAY the rest is a grade? (latest correction wins; else the recipe.)
  const latestAtt = attempts.length ? attempts[attempts.length - 1] : null;
  const attHandoff =
    latestAtt && latestAtt.correction && latestAtt.correction.status === "handoff_to_grade";
  const recipeHandoff =
    !attHandoff && chain?.recipe && chain.recipe.status === "handoff_to_grade";
  const modelSaysHandoff = !!(attHandoff || recipeHandoff);
  const handoffReason = attHandoff
    ? latestAtt!.correction.status_reason || ""
    : recipeHandoff
      ? chain!.recipe!.status_reason || ""
      : "";
  // Show the "keep refining" caution only when the model jumped the gun: it declared a
  // handoff, but the measured look-distance says we're not there yet.
  const prematureHandoff = modelSaysHandoff && !measuredMatched;

  const heroTone = scoreTone(bestScore);
  const refSrc = safeSrc(session.ref.dataUrl);

  return (
    <div className="flex flex-col gap-4">
      {/* MATCHED milestone — gated on the MEASURED score, not the model's word. */}
      {measuredMatched && (
        <div
          className="rounded-[var(--radius-card)] border p-4 flex gap-3 animate-rise"
          style={{ borderColor: "var(--color-good)", background: "var(--color-good-tint)" }}
        >
          <span
            className="flex-none grid place-items-center w-7 h-7 rounded-full text-white text-[0.82rem] font-bold"
            style={{ background: "var(--color-good)" }}
            aria-hidden
          >
            ✓
          </span>
          <div>
            <div className="text-[0.95rem] font-[660] text-[var(--color-ink)] tracking-[-0.01em]">
              Lighting matched. The rest is a grade.
            </div>
            <p className="text-[0.82rem] text-[var(--color-ink-2)] mt-1 leading-snug max-w-[70ch]">
              {handoffReason ? handoffReason + " — " : ""}the closest attempt measures {bestPercent}% match
              (look distance {bestScoreRounded}, within {MATCH_THRESHOLD}) — the lighting is within noise of
              the reference; take the rest to REFGRADE.
            </p>
          </div>
        </div>
      )}

      {/* Premature-handoff caution — model gave up early but the measurement disagrees. */}
      {prematureHandoff && (
        <div
          className="rounded-[var(--radius-card)] border p-4 flex gap-3 animate-rise"
          style={{ borderColor: "var(--color-warn)", background: "var(--color-warn-tint)" }}
        >
          <span
            className="flex-none grid place-items-center w-7 h-7 rounded-full text-white text-[0.82rem] font-bold"
            style={{ background: "var(--color-warn)" }}
            aria-hidden
          >
            !
          </span>
          <div>
            <div className="text-[0.95rem] font-[660] text-[var(--color-ink)] tracking-[-0.01em]">
              Model suggests the rest is a grade — but the measured look-distance is still {bestScoreRounded}
              &nbsp;({bestPercent}% match).
            </div>
            <p className="text-[0.82rem] text-[var(--color-ink-2)] mt-1 leading-snug max-w-[70ch]">
              {handoffReason ? handoffReason + " — " : ""}that&rsquo;s past the {MATCH_THRESHOLD}-point match
              threshold. Keep refining, or accept it as close enough and take it to REFGRADE.
            </p>
          </div>
        </div>
      )}

      {/* Filmstrip: reference + each attempt, closest at the lowest score. */}
      <section className="work-card p-4">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-baseline gap-2.5">
            <span className="eyebrow">Refine ledger</span>
            <span className="text-[0.72rem] text-[var(--color-faint)]">closest at the lowest score</span>
          </div>
          {/* HERO stat: the promised "% match" of the closest attempt. */}
          <div className="flex items-baseline gap-2">
            <span
              className="tabular-nums font-bold tracking-[-0.02em] text-[1.85rem] leading-none"
              style={{ color: heroTone.color }}
            >
              {bestPercent}%
            </span>
            <span className="text-[0.74rem] font-medium text-[var(--color-muted)] leading-tight">
              match
              <span className="block text-[0.66rem] text-[var(--color-faint)] font-normal">
                closest · look dist {bestScoreRounded}
              </span>
            </span>
          </div>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
          {/* reference anchor */}
          <figure className="flex-none w-[132px]">
            <div className="rounded-[10px] overflow-hidden border-2 border-[var(--color-accent-line)] bg-[var(--color-surface-2)] aspect-[4/3]">
              {refSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={refSrc} alt="Reference" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center text-[0.68rem] text-[var(--color-faint)]">
                  unavailable
                </div>
              )}
            </div>
            <figcaption className="mt-1.5 text-center">
              <span className="text-[0.7rem] font-semibold text-[var(--color-accent-ink)]">Reference</span>
              <div className="text-[0.62rem] text-[var(--color-faint)]">the target</div>
            </figcaption>
          </figure>

          {attempts.map((att, idx) => (
            <FilmstripAttempt key={idx} att={att} idx={idx} prev={idx > 0 ? attempts[idx - 1] : null} />
          ))}
        </div>

        {/* the scale legend + caveat */}
        <div className="mt-3 pt-3 border-t border-[var(--color-line)] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[0.72rem] text-[var(--color-muted)]">
            <span>look distance (0–100)</span>
            <span className="relative h-2 w-28 rounded-full overflow-hidden spectrum-bar" aria-hidden />
            <span className="text-[var(--color-faint)]">lower is closer</span>
          </div>
          <span className="text-[0.76rem] italic text-[var(--color-muted)]">
            trust your eyes first, the numbers second
          </span>
        </div>
      </section>

      {/* correction cards (newest last, matching the attempt order) */}
      {attempts.map((att, idx) => (
        <CorrectionCard key={idx} att={att} idx={idx} target={target} onToast={onToast} />
      ))}
    </div>
  );
}

function scoreTone(score: number): { color: string; bg: string } {
  // low score = close = good (cool→green), high = far (warm). The `color` is used as
  // TEXT on the tint `bg`, so it uses the AA-safe -ink shades. Buckets are DERIVED from
  // MATCH_THRESHOLD so "green/good" means genuinely matched and can't drift from the gate:
  //   good  <= MATCH_THRESHOLD     (1.5)  — matched (99%)
  //   info  <= 3x threshold        (4.5)  — close
  //   warn  <= ~7x threshold       (9.5)  — work to do
  //   danger otherwise                   — far
  const INFO_MAX = MATCH_THRESHOLD * 3; // 4.5
  const WARN_MAX = MATCH_THRESHOLD * 7 - 1; // 9.5
  if (score <= MATCH_THRESHOLD) return { color: "var(--color-good-ink)", bg: "var(--color-good-tint)" };
  if (score <= INFO_MAX) return { color: "var(--color-info-ink)", bg: "var(--color-info-tint)" };
  if (score <= WARN_MAX) return { color: "var(--color-warn-ink)", bg: "var(--color-surface-2)" };
  return { color: "var(--color-danger-ink)", bg: "var(--color-danger-tint)" };
}

function FilmstripAttempt({
  att,
  idx,
  prev,
}: {
  att: AttemptEntry;
  idx: number;
  prev: AttemptEntry | null;
}) {
  const n = useEngine((s) => s.attemptNumberAt(idx));
  const src = safeSrc(att.dataUrl);
  const tone = scoreTone(att.score);
  let trend: React.ReactNode = null;
  if (prev) {
    trend =
      att.score < prev.score ? (
        <span className="text-[var(--color-good-ink)]" title="Closer to reference">▲</span>
      ) : att.score > prev.score ? (
        <span className="text-[var(--color-danger-ink)]" title="Further from reference">▼</span>
      ) : (
        <span className="text-[var(--color-faint)]">–</span>
      );
  }
  return (
    <figure className="flex-none w-[132px]">
      <div className="rounded-[10px] overflow-hidden border border-[var(--color-line)] bg-[var(--color-surface-2)] aspect-[4/3]">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`Attempt ${n}`} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-[0.68rem] text-[var(--color-faint)]">
            unavailable
          </div>
        )}
      </div>
      <figcaption className="mt-1.5 text-center">
        <span className="text-[0.7rem] font-medium text-[var(--color-muted)]">Attempt {n}</span>
        <div className="mt-0.5 inline-flex items-center gap-1">
          <span
            className="jewel text-[0.78rem] font-bold rounded-md px-1.5 py-0.5"
            style={{ color: tone.color, background: tone.bg }}
          >
            {Math.round(att.score)}
          </span>
          {trend && <span className="text-[0.7rem]">{trend}</span>}
        </div>
      </figcaption>
    </figure>
  );
}

function CorrectionCard({
  att,
  idx,
  target,
  onToast,
}: {
  att: AttemptEntry;
  idx: number;
  target: TargetId;
  onToast: (m: string) => void;
}) {
  const n = useEngine((s) => s.attemptNumberAt(idx));
  if (!att.correction) return null;
  const c = att.correction;
  const tone = scoreTone(att.score);

  const onToggle = async (param: string) => {
    try {
      await engineStore.getState().toggleAttemptApplied(idx, param);
    } catch {
      /* busy */
    }
  };

  return (
    <section className="work-card overflow-hidden animate-rise">
      <div className="flex items-center justify-between gap-3 px-5 pt-3.5 pb-3 border-b border-[var(--color-line)]">
        <div className="flex items-center gap-2.5">
          <h3 className="text-[0.9rem] font-[640] text-[var(--color-ink)] tracking-[-0.01em]">Correction · attempt {n}</h3>
          <span
            className="jewel text-[0.72rem] font-bold rounded-md px-2 py-0.5"
            style={{ color: tone.color, background: tone.bg }}
            title="look distance (0–100)"
          >
            look distance {Math.round(att.score)}
          </span>
        </div>
      </div>
      <div className="px-3 sm:px-4 py-2 flex flex-col gap-1">
        {(c.moves || []).map((m) => {
          const entry = PACKS.lookup(target, m.param);
          const uiPath = entry ? entry.ui_path : m.param;
          const unit = entry?.unit || "";
          const kind = entry?.kind || "spinner";
          const appliedFalse = !!(att.appliedParams && att.appliedParams[m.param] === false);
          const copy =
            kind === "placement" ? `${uiPath} → ${m.to}` : `${uiPath} → ${m.to}${typeof m.to === "number" ? unit : ""}`;
          return (
            <div key={m.param} className="flex items-start gap-3 rounded-[10px] px-3 py-2.5 hover:bg-[var(--color-surface-2)] transition-colors">
              <ConfDot confidence={m.confidence} />
              <div className="min-w-0 flex-1">
                {/* breadcrumb wraps in its own column; value jewel stays pinned right. */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <PathBreadcrumb uiPath={uiPath} />
                  </div>
                  <div className="flex items-start gap-2 flex-none max-w-[58%]">
                    <ValueJewel from={m.from} value={m.to} unit={unit} kind={kind} />
                    <ClampedFlag show={m.clamped} />
                  </div>
                </div>
                {m.why && <p className="text-[0.76rem] text-[var(--color-muted)] mt-1 leading-snug">{m.why}</p>}
              </div>
              <div className="flex items-center gap-2 flex-none pt-0.5">
                <label className="flex items-center gap-1 text-[0.68rem] text-[var(--color-muted)] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!appliedFalse}
                    onChange={() => onToggle(m.param)}
                    className="accent-[var(--color-accent-strong)] w-3 h-3"
                  />
                  applied
                </label>
                <button
                  className="btn-mini !px-1.5 !py-0.5"
                  onClick={async () => {
                    await copyText(copy);
                    onToast("Copied.");
                  }}
                >
                  copy
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {c.status_reason && (
        <div className="px-5 py-2.5 border-t border-[var(--color-line)] text-[0.76rem] text-[var(--color-muted)] leading-snug">
          {c.status_reason}
        </div>
      )}
    </section>
  );
}
