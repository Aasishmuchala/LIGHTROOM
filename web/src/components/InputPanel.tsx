"use client";

import { engineStore, useEngine } from "@/store/useEngine";
import { DropSlot } from "./DropSlot";
import { SLOT_DEFS, CHIP_GROUPS, acceptsFile } from "./lib";

// Numbered, teaching flow. Reads top-to-bottom: 1 drop the frames → 2 set the scene
// → 3 Analyze → 4 Refine (only once there's a recipe). Every control is wired to the
// engine store; nothing here reimplements engine logic. ---------------------------
export function InputPanel({
  focusedSlot,
  setFocusedSlot,
  onToast,
}: {
  focusedSlot: string | null;
  setFocusedSlot: (s: string | null) => void;
  onToast: (m: string) => void;
}) {
  const session = useEngine((s) => s.session);
  const state = useEngine((s) => s.state());
  const inFlight = useEngine((s) => !!s._inFlight);
  const chain = useEngine((s) => s.activeChain());
  // EXR develop state per named slot (drives the exposure slider). Reading the whole
  // record (stable ref unless an EXR slot changes) is fine for a selector.
  const exrSlots = useEngine((s) => s.exrSlots);
  // Derive attempt counts from the (stable-ref) chain rather than calling
  // attemptInfo() in the selector, which returns a fresh object each render and
  // would loop useSyncExternalStore.
  const info = {
    n: chain ? (typeof chain._attemptCount === "number" ? chain._attemptCount : chain.attempts.length) : 0,
    stored: chain ? chain.attempts.length : 0,
  };

  const hasRecipe = !!(chain && chain.recipe);
  const analyzeReady = state !== "empty";
  const refining = state === "analyzed" || state === "refining";
  const otherTarget =
    session.activeTarget === "vray7max" ? "Chaos Vantage 3.3" : "V-Ray 7";

  const slotData = (key: string): string | null =>
    key === "ref"
      ? session.ref?.dataUrl ?? null
      : key === "base"
        ? session.base?.dataUrl ?? null
        : session.settingsShot?.dataUrl ?? null;

  // Ingest a file into a slot: EXR/other reject with the verbatim message; otherwise
  // hand the File straight to the engine (it decodes/measures/downscales).
  const ingest = async (slot: string, file: File) => {
    const check = acceptsFile(file);
    if (!check.ok) {
      onToast(check.reason);
      return;
    }
    try {
      if (slot === "attempt") {
        const { score } = await engineStore.getState().addAttempt(file);
        onToast(`Attempt scored. Look distance ${Math.round(score)}.`);
      } else {
        await engineStore.getState().setImage(slot as "ref" | "base" | "settings", file);
      }
      setFocusedSlot(null);
    } catch {
      /* the store records lastError; the banner shows it */
    }
  };

  const setChip = (group: string, value: string) => {
    const cur = session.context?.[group];
    engineStore.getState().setContext({ [group]: cur === value ? "" : value });
  };

  // Re-expose an EXR-developed named slot from its retained linear buffer (instant,
  // client-side). Errors are recorded on the store's lastError banner.
  const onExrEv = (slot: "ref" | "base" | "settings", ev: number) => {
    engineStore.getState().redevelopExrSlot(slot, ev).catch(() => {
      /* banner shows it */
    });
  };

  const doAnalyze = async () => {
    try {
      await engineStore.getState().analyze();
      onToast(hasRecipe ? "Re-analyzed." : "Recipe ready.");
    } catch {
      /* banner shows it */
    }
  };
  const doReanalyzeOther = async () => {
    try {
      await engineStore.getState().reanalyzeOtherTarget();
      onToast(`Analyzed for ${otherTarget}.`);
    } catch {
      /* banner */
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      {/* Step 1 — the two frames */}
      <Step n={1} title="Drop your two frames" tone="key">
        <div className="flex flex-col gap-2.5">
          {SLOT_DEFS.map((def) => {
            const exr = exrSlots[def.key as "ref" | "base" | "settings"];
            return (
              <DropSlot
                key={def.key}
                slotKey={def.key}
                label={def.label}
                hint={def.hint}
                dataUrl={slotData(def.key)}
                focused={focusedSlot === def.key}
                onFocus={() => setFocusedSlot(def.key)}
                onFile={(f) => ingest(def.key, f)}
                compact={def.key === "settings"}
                exrEv={exr ? exr.ev : null}
                onExrEv={(ev) => onExrEv(def.key as "ref" | "base" | "settings", ev)}
              />
            );
          })}
        </div>
        <p className="text-[0.72rem] text-[var(--color-faint)] mt-2 pl-0.5">
          Same VFB display settings every attempt.
        </p>
      </Step>

      {/* Step 2 — scene context (the FULL time-of-day set) */}
      <Step n={2} title="Set the scene" sub="Optional. Sharpens the match; skip if unsure.">
        <div className="flex flex-col gap-3">
          {CHIP_GROUPS.map((group) => (
            <div key={group.key}>
              <div className="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-[var(--color-faint)] mb-1.5">
                {group.label}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.options.map((opt) => (
                  <button
                    key={opt}
                    className="btn-chip"
                    data-on={session.context?.[group.key] === opt}
                    onClick={() => setChip(group.key, opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Step>

      {/* Step 3 — analyze */}
      <Step n={3} title={hasRecipe ? "Re-analyze" : "Analyze"}>
        <button className="btn btn-primary w-full" disabled={!analyzeReady || inFlight} onClick={doAnalyze}>
          {inFlight ? (
            <>
              <Spinner /> Analyzing…
            </>
          ) : (
            <>{hasRecipe ? "Re-analyze" : "Analyze the match"}</>
          )}
        </button>
        {!analyzeReady && (
          <p className="text-[0.72rem] text-[var(--color-faint)] mt-2 text-center">
            Add a reference and a base render to begin.
          </p>
        )}
        {refining && (
          <button className="btn btn-secondary w-full mt-2 !text-[0.8rem]" disabled={inFlight} onClick={doReanalyzeOther}>
            Also match for {otherTarget}
          </button>
        )}
      </Step>

      {/* Step 4 — refine (only with a recipe) */}
      {refining && (
        <Step n={4} title="Refine" sub="Apply the recipe, re-render, drop the result back in.">
          <DropSlot
            slotKey="attempt"
            label="Attempt"
            hint={`${info.n} so far · becomes ${info.n + 1}`}
            focused={focusedSlot === "attempt"}
            onFocus={() => setFocusedSlot("attempt")}
            onFile={(f) => ingest("attempt", f)}
            captionOverride={`Drop the re-render, becomes attempt ${info.n + 1}`}
          />
          <p className="text-[0.72rem] text-[var(--color-faint)] mt-2 pl-0.5">
            Same VFB display settings every attempt.
          </p>
        </Step>
      )}
    </div>
  );
}

function Step({
  n,
  title,
  sub,
  tone,
  children,
}: {
  n: number;
  title: string;
  sub?: string;
  tone?: "key";
  children: React.ReactNode;
}) {
  return (
    <section className="card p-3.5">
      <div className="flex items-center gap-2.5 mb-3">
        <span
          className={`grid place-items-center w-6 h-6 rounded-full text-[0.72rem] font-bold flex-none ${
            tone === "key"
              ? "bg-[var(--color-accent)] text-[oklch(0.28_0.09_62)]"
              : "bg-[var(--color-accent-tint)] text-[var(--color-accent-ink)]"
          }`}
        >
          {n}
        </span>
        <div>
          <h3 className="text-[0.92rem] font-[620] text-[var(--color-ink)] leading-tight">{title}</h3>
          {sub && <p className="text-[0.72rem] text-[var(--color-faint)] leading-tight mt-0.5">{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
      aria-hidden
    />
  );
}
