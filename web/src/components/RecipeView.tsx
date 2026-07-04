"use client";

import { useMemo } from "react";
import { engineStore, useEngine } from "@/store/useEngine";
import { PACKS } from "@/lib/packs";
import type { Recipe, TargetId } from "@/lib/types";
import { PathBreadcrumb, ConfDot, ValueJewel, ClampedFlag } from "./bits";
import { buildSheet, buildSheetText, copyText, sheetForTarget, type SheetRow } from "./lib";
import { MoveHelp } from "./MoveHelp";

// The recipe view LEADS WITH THE CHANGES. Opens with "N changes to match this
// reference" + the changed moves as clean rows (breadcrumb + name, from → to jewel,
// why). The complete panel sits behind an opt-in disclosure, collapsed by default.
export function RecipeView({ onToast }: { onToast: (m: string) => void }) {
  const session = useEngine((s) => s.session);
  const chain = useEngine((s) => s.activeChain());
  const target = session.activeTarget as TargetId;
  // Stable, cached scaffold (see sheetForTarget) — selecting s.sheetFor(target) in a
  // zustand selector would return a fresh array each render and loop.
  const scaffold = sheetForTarget(target);

  const recipe = chain?.recipe || null;
  const recipeApplied = chain?.recipeApplied ?? null;

  const rows = useMemo(
    () => buildSheet(scaffold, recipe, { recipeApplied }),
    [scaffold, recipe, recipeApplied]
  );

  if (!recipe) return null;

  const targetLabel =
    (PACKS as unknown as Record<string, { label: string } | undefined>)[target]?.label || target;
  const baselineText =
    recipe.baseline === "settings_screenshot" ? "settings screenshot" : "factory defaults";

  const changedRows = rows.filter((r) => r.isChanged);
  const totalChanged = changedRows.length;
  const changeWord = totalChanged === 1 ? "change" : "changes";

  // group rows into bands (order preserved by buildSheet).
  const bandOrder: string[] = [];
  const bandMap = new Map<string, SheetRow[]>();
  for (const row of rows) {
    if (!bandMap.has(row.group)) {
      bandMap.set(row.group, []);
      bandOrder.push(row.group);
    }
    bandMap.get(row.group)!.push(row);
  }

  const onCopySheet = async () => {
    await copyText(buildSheetText(target, scaffold, recipe, { recipeApplied }));
    onToast("Full settings sheet copied.");
  };
  const onCopyJson = async () => {
    await copyText(JSON.stringify(recipe, null, 2));
    onToast("Recipe JSON copied.");
  };

  return (
    <div className="animate-rise">
      <div className="work-card work-card--hero overflow-hidden">
        {/* faceplate: what this is + the target + copy affordances */}
        <div className="flex items-center justify-between gap-3 px-5 pt-3.5 pb-3 border-b border-[var(--color-line)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="eyebrow">Lighting recipe</span>
            <span className="w-1 h-1 rounded-full bg-[var(--color-line-strong)]" aria-hidden />
            <span className="text-[0.82rem] font-[620] text-[var(--color-ink)] truncate tracking-[-0.01em]">
              {targetLabel}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-none">
            <button className="btn-mini" onClick={onCopySheet}>
              Copy sheet
            </button>
            <button className="btn-mini" onClick={onCopyJson}>
              Copy JSON
            </button>
          </div>
        </div>

        {/* CHANGES HERO — the answer, first. Oversized tabular numeral leads; the
            calibration read-out (the spectrum with a live tick) makes the match
            feel measured, not asserted. */}
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-4 sm:gap-5">
            <div className="flex items-baseline gap-1 flex-none">
              <span className="text-[3.4rem] sm:text-[4rem] font-[760] tracking-[-0.045em] leading-[0.82] tabular-nums text-[var(--color-ink)]">
                {totalChanged}
              </span>
            </div>
            <div className="min-w-0 pt-1">
              <div className="text-[1.12rem] sm:text-[1.2rem] font-[660] text-[var(--color-ink)] leading-tight tracking-[-0.015em]">
                {changeWord} to match this reference
              </div>
              <p className="text-[0.8rem] text-[var(--color-muted)] mt-1.5 max-w-[58ch] leading-snug">
                Each move is one control to set in {targetLabel}. Everything you don’t touch stays at its
                held default — baseline: <span className="text-[var(--color-ink-2)]">{baselineText}</span>.
              </p>
            </div>
          </div>

          {/* calibration read-out — the signature spectrum, load-bearing: the axis the
              tool measures on, with the matched temperature marked. */}
          <CalibrationReadout changed={totalChanged} total={rows.length} />
        </div>

        {/* changed rows — the light-meter ledger */}
        <div className="px-3 sm:px-4 pb-3 flex flex-col">
          <div className="flex items-center gap-3 px-3 pb-1.5">
            <span className="eyebrow">The moves</span>
            <span className="h-px flex-1 bg-[var(--color-line)]" aria-hidden />
          </div>
          {changedRows.map((row, i) => (
            <ChangeRow key={row.param} row={row} index={i} target={target} />
          ))}
        </div>

        {/* OPT-IN full settings panel */}
        <details className="group border-t border-[var(--color-line)]">
          <summary className="flex items-center gap-2.5 px-5 py-3.5 hover:bg-[var(--color-surface-2)] transition-colors select-none">
            <span className="caret text-[var(--color-accent)] text-[0.75rem]">▸</span>
            <span className="text-[0.88rem] font-[580] text-[var(--color-ink)]">
              Show the full settings panel
            </span>
            <span className="text-[0.74rem] text-[var(--color-faint)]">
              {totalChanged} changed · {rows.length} controls
            </span>
          </summary>
          <div className="px-4 pb-4 pt-1 bg-[var(--color-surface-2)]">
            <p className="text-[0.76rem] text-[var(--color-muted)] px-1 pt-2 pb-3 max-w-[64ch]">
              Every control in {targetLabel}, in panel order. Changed controls are highlighted; bands with
              no change stay collapsed.
            </p>
            <div className="flex flex-col gap-2">
              {bandOrder.map((group) => (
                <SheetBand key={group} group={group} rows={bandMap.get(group)!} onToast={onToast} />
              ))}
            </div>
          </div>
        </details>

        {/* rationale / mood / gi */}
        <div className="px-5 py-4 border-t border-[var(--color-line)] flex flex-col gap-3">
          {recipe.rationale && (
            <details className="group">
              <summary className="flex items-center gap-2 text-[0.82rem] font-[560] text-[var(--color-ink-2)] hover:text-[var(--color-ink)]">
                <span className="caret text-[0.68rem] text-[var(--color-faint)]">▸</span> Rationale
              </summary>
              <p className="text-[0.82rem] text-[var(--color-ink-2)] leading-relaxed mt-2 max-w-[68ch] pl-4">
                {recipe.rationale}
              </p>
            </details>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            {recipe.hdri_mood && (
              <div className="flex-1 rounded-[var(--radius-control)] bg-[var(--color-accent-tint)] border border-[var(--color-accent-line)] px-3.5 py-2.5">
                <div className="text-[0.66rem] font-semibold uppercase tracking-[0.06em] text-[var(--color-accent-ink)]">
                  HDRI mood
                </div>
                <div className="text-[0.82rem] text-[var(--color-ink-2)] mt-1 leading-snug">{recipe.hdri_mood}</div>
              </div>
            )}
            {recipe.gi_notes && (
              <div className="flex-1 rounded-[var(--radius-control)] bg-[var(--color-surface-2)] border border-[var(--color-line)] px-3.5 py-2.5">
                <div className="text-[0.66rem] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">
                  GI notes
                </div>
                <div className="text-[0.82rem] text-[var(--color-ink-2)] mt-1 leading-snug">{recipe.gi_notes}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// -- the calibration read-out: the signature spectrum axis with a live tick at the
// matched temperature. Meaningful mapping — a fully-matched recipe (no moves) reads at
// the cool/settled end; more changes push the tick warm (more light-energy to move).
// This is the spectrum used AS an instrument, not a decorative stripe. --------------
function CalibrationReadout({ changed, total }: { changed: number; total: number }) {
  // fraction of the panel that changed → tick position. Clamp so it always sits
  // clearly inside the scale. Cool (left, settled) → warm (right, more to move).
  const frac = total > 0 ? Math.min(1, changed / Math.max(8, total * 0.35)) : 0;
  const pct = 6 + frac * 88; // keep the tick off the very edges
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="eyebrow">Calibration</span>
        <span className="jewel text-[0.68rem] text-[var(--color-muted)] tabular-nums">
          <span className="text-[var(--color-accent-ink)] font-semibold">{changed}</span>
          <span className="mx-0.5">/</span>
          {total} controls
        </span>
      </div>
      <div className="calib-scale" role="presentation">
        <span className="calib-tick" style={{ left: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[0.62rem] font-medium text-[var(--color-faint)]">settled</span>
        <span className="text-[0.62rem] font-medium text-[var(--color-faint)]">more to move</span>
      </div>
    </div>
  );
}

// -- one changed move in the hero ledger — breadcrumb + jewel + applied toggle. Rows
// are separated by hairlines so the list reads as a printed spec sheet. ------------
function ChangeRow({ row, index, target }: { row: SheetRow; index: number; target: TargetId }) {
  const onToggle = async (applied: boolean) => {
    try {
      await engineStore.getState().setRecipeApplied(row.param, applied);
    } catch {
      /* busy: the render snaps it back */
    }
  };
  return (
    <div
      className="flex flex-col rounded-[8px] px-3 py-2.5 hover:bg-[var(--color-surface-2)] transition-colors animate-rise border-b border-[var(--color-line)] last:border-b-0"
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
    >
      <div className="group flex items-start gap-3">
        <ConfDot confidence={row.confidence} />
        <div className="min-w-0 flex-1">
          {/* breadcrumb wraps freely in its own column; the value jewel stays pinned to
              the top-right and never drops to an orphaned line. */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <PathBreadcrumb uiPath={row.ui_path} />
            </div>
            <div className="flex items-start gap-2 flex-none max-w-[58%]">
              <ValueJewel from={row.from} value={row.value} unit={row.unit} kind={row.kind} />
              <ClampedFlag show={row.clamped} />
            </div>
          </div>
          {row.why && (
            <p className="text-[0.76rem] text-[var(--color-muted)] mt-1 leading-snug max-w-[70ch]">{row.why}</p>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-[0.7rem] text-[var(--color-muted)] cursor-pointer flex-none pt-0.5 select-none">
          <input
            type="checkbox"
            checked={row.applied !== false}
            onChange={(e) => onToggle(e.target.checked)}
            className="accent-[var(--color-accent-strong)] w-3.5 h-3.5"
          />
          applied
        </label>
      </div>
      {/* per-move walkthrough — spans the FULL row width (not the inset content column)
          so the chat + follow-up field stay usable on narrow/mobile viewports. Keyed by
          target+param+value so a re-analyze that changes this control's target value (or a
          renderer flip) starts a FRESH conversation instead of resurfacing the previous
          recipe's stale chat for a control whose param happens to recur. */}
      <MoveHelp key={`${target}:${row.param}:${row.value}`} row={row} target={target} />
    </div>
  );
}

// -- a settings band: changed bands open; all-held bands collapse behind a summary.
function SheetBand({
  group,
  rows,
  onToast,
}: {
  group: string;
  rows: SheetRow[];
  onToast: (m: string) => void;
}) {
  const changed = rows.filter((r) => r.isChanged).length;
  const count = (
    <span className="text-[0.68rem] text-[var(--color-faint)] tabular-nums">
      <span className={changed ? "text-[var(--color-accent-ink)] font-semibold" : ""}>{changed} changed</span>
      <span className="mx-1">·</span>
      {rows.length} total
    </span>
  );
  const body = (
    <div className="flex flex-col divide-y divide-[var(--color-line)]">
      {rows.map((r) => (
        <SheetRowItem key={r.param} row={r} onToast={onToast} />
      ))}
    </div>
  );

  if (changed > 0) {
    return (
      <section className="rounded-[8px] bg-[var(--color-surface)] border border-[var(--color-accent-line)] shadow-[inset_0_0_0_1px_var(--color-line-strong)] overflow-hidden">
        <header className="flex items-center justify-between gap-2 px-3 py-2 bg-[var(--color-accent-tint)] border-b border-[var(--color-accent-line)]">
          <span className="text-[0.78rem] font-[620] text-[var(--color-ink)] tracking-[-0.01em]">{group}</span>
          {count}
        </header>
        {body}
      </section>
    );
  }
  return (
    <details className="rounded-[8px] bg-[var(--color-surface)] border border-[var(--color-line-strong)] overflow-hidden group">
      <summary className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-[var(--color-surface-2)] transition-colors select-none">
        <span className="flex items-center gap-2 min-w-0">
          <span className="caret text-[0.62rem] text-[var(--color-faint)]">▸</span>
          <span className="text-[0.78rem] font-[540] text-[var(--color-muted)] truncate">{group}</span>
        </span>
        {count}
      </summary>
      {body}
    </details>
  );
}

// -- one sheet row: changed = jewel + toggle + copy; held = compact muted line. ----
function SheetRowItem({
  row,
  onToast,
}: {
  row: SheetRow;
  onToast: (m: string) => void;
}) {
  if (!row.isChanged) {
    const unit = row.unit && typeof row.value === "number" ? row.unit : "";
    return (
      <div className={`flex items-center justify-between gap-3 px-3 py-1.5 ${row.lighting ? "" : "opacity-60"}`}>
        <div className="min-w-0 opacity-80">
          <PathBreadcrumb uiPath={row.ui_path} />
        </div>
        <span className="jewel text-[0.74rem] text-[var(--color-faint)] flex-none">
          {String(row.value)}
          {unit && <span className="text-[0.62rem] ml-0.5">{unit}</span>}
        </span>
      </div>
    );
  }

  const onToggle = async (applied: boolean) => {
    try {
      await engineStore.getState().setRecipeApplied(row.param, applied);
    } catch {
      /* busy */
    }
  };
  const unit = row.unit && typeof row.value === "number" ? row.unit : "";
  const copy =
    row.kind === "placement"
      ? `${row.ui_path} → ${row.value}`
      : `${row.ui_path} → ${row.value}${unit}`;

  return (
    <div className="flex items-start gap-3 px-3 py-2.5 bg-[var(--color-accent-tint)]/40">
      <ConfDot confidence={row.confidence} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <PathBreadcrumb uiPath={row.ui_path} />
          </div>
          <div className="flex items-start gap-2 flex-none max-w-[58%]">
            <ValueJewel from={row.from} value={row.value} unit={row.unit} kind={row.kind} />
            <ClampedFlag show={row.clamped} />
          </div>
        </div>
        {row.why && <p className="text-[0.74rem] text-[var(--color-muted)] mt-1 leading-snug">{row.why}</p>}
      </div>
      <div className="flex items-center gap-2 flex-none pt-0.5">
        <label className="flex items-center gap-1 text-[0.68rem] text-[var(--color-muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={row.applied !== false}
            onChange={(e) => onToggle(e.target.checked)}
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
}
