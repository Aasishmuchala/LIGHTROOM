"use client";

import { engineStore, useEngine } from "@/store/useEngine";
import { DropSlot } from "./DropSlot";
import { MaxBridge } from "./MaxBridge";
import { SLOT_DEFS, CHIP_GROUPS, acceptsFile } from "./lib";

// The two primary image ports. The settings-screenshot slot was retired from the UI
// (the engine still treats a missing settings shot as "baseline = factory defaults"),
// so only Reference + Base render remain — and they get to be the main event.
const PRIMARY_SLOTS = SLOT_DEFS.filter((d) => d.key !== "settings");

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

  const hasRecipe = !!(chain && chain.recipe);
  const analyzeReady = state !== "empty";
  const refining = state === "analyzed" || state === "refining";
  const otherTarget =
    session.activeTarget === "vray7max" ? "Chaos Vantage 3.3" : "V-Ray 7";
  // Purely presentational progress read-out on the rail faceplate. The rail's job is to
  // PRODUCE a recipe — three steps (frames → scene → analyze). Refining (dropping a
  // re-render, reading the score) now lives on the readout beside the ledger, so it is
  // no longer a rail step. Once a recipe exists the rail has done its job (3/3).
  const currentStep = hasRecipe || analyzeReady ? 3 : 1;
  const stepBadge = `Step ${currentStep} / 3`;

  const slotData = (key: string): string | null =>
    key === "ref" ? session.ref?.dataUrl ?? null : session.base?.dataUrl ?? null;

  // Ingest a file into a named slot (ref / base): EXR/other reject with the verbatim
  // message; otherwise hand the File straight to the engine (it decodes/measures/
  // downscales). The attempt drop now lives in the readout's RefineDock.
  const ingest = async (slot: "ref" | "base", file: File) => {
    const check = acceptsFile(file);
    if (!check.ok) {
      onToast(check.reason);
      return;
    }
    try {
      await engineStore.getState().setImage(slot, file);
      setFocusedSlot(null);
    } catch {
      /* the store records lastError; the banner shows it */
    }
  };

  const setChip = (group: string, value: string) => {
    const cur = session.context?.[group];
    engineStore.getState().setContext({ [group]: cur === value ? "" : value });
  };

  // Re-expose an EXR-developed named slot from its retained linear buffer. RETURNS the
  // engine promise: DropSlot's commit queue awaits it so full-res redevelops never
  // overlap or land out of order (finding C5). Errors are recorded on the store's
  // lastError banner.
  const onExrEv = (slot: "ref" | "base", ev: number) =>
    engineStore.getState().redevelopExrSlot(slot, ev).catch(() => {
      /* banner shows it */
    });

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
    <div className="rail p-3 sm:p-3.5 flex flex-col">
      {/* rail faceplate — one structural label for the whole control panel */}
      <div className="flex items-center justify-between gap-2 px-1 pt-0.5 pb-3">
        <span className="eyebrow text-[oklch(0.85_0.012_80)]">Inputs</span>
        <span className="eyebrow !tracking-[0.04em] text-[oklch(0.85_0.012_80)]">
          {stepBadge}
        </span>
      </div>

      <div className="flex flex-col">
        {/* Step 1 — the two frames. These are the primary inputs: large, generous ports. */}
        <Step n={1} title="Drop your two frames" tone="key" first>
          <div className="flex flex-col gap-3">
            {PRIMARY_SLOTS.map((def) => {
              const exr = exrSlots[def.key as "ref" | "base"];
              return (
                <DropSlot
                  key={def.key}
                  slotKey={def.key}
                  label={def.label}
                  hint={def.hint}
                  dataUrl={slotData(def.key)}
                  focused={focusedSlot === def.key}
                  onFocus={() => setFocusedSlot(def.key)}
                  onFile={(f) => ingest(def.key as "ref" | "base", f)}
                  large
                  exrEv={exr ? exr.ev : null}
                  onExrEv={(ev) => onExrEv(def.key as "ref" | "base", ev)}
                />
              );
            })}
          </div>
          <p className="text-[0.72rem] text-[oklch(0.83_0.012_80)] mt-3 pl-0.5">
            Same VFB display settings every attempt.
          </p>
        </Step>

        {/* Step 2 — scene context (the FULL time-of-day set) */}
        <Step n={2} title="Set the scene" sub="Optional. Sharpens the match; skip if unsure.">
          <div className="flex flex-col gap-3.5">
            {CHIP_GROUPS.map((group) => {
              const active = group.options.filter((o) => session.context?.[group.key] === o).length > 0;
              return (
                <div key={group.key} className="chip-group">
                  <div className="chip-group-label">
                    <span>{group.label}</span>
                    <span
                      className={`chip-group-dot ${active ? "is-set" : ""}`}
                      aria-hidden
                    />
                  </div>
                  <div className="chip-grid">
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
              );
            })}
          </div>
          {/* Live 3ds Max bridge — optional accelerator: pulls the scene's REAL
              current values so recipes baseline on truth, not assumed defaults. */}
          <div className="mt-3">
            <MaxBridge onToast={onToast} />
          </div>
        </Step>

        {/* Step 3 — analyze: the commit action of the flow (last rail step; refining
            happens on the readout beside the recipe) */}
        <Step n={3} title={hasRecipe ? "Re-analyze" : "Analyze"} last>
          <div className="flex flex-col">
            {/* AREA MODE — the big-project switch. On: this session is a per-area pass;
                sun/sky/fog/color-mapping stay frozen (matched once on the hero shot) and
                the recipe solves with camera exposure + local lights only. The engine
                withholds any global move the model emits anyway. */}
            <button
              type="button"
              className="area-lock mb-2.5"
              data-on={session.lockGlobals === true}
              aria-pressed={session.lockGlobals === true}
              onClick={() =>
                engineStore.getState().setLockGlobals(!(session.lockGlobals === true))
              }
              title="Per-area pass on a big project: keep sun, sky, fog & color mapping frozen — solve this shot with camera exposure and local lights only."
            >
              <span className="area-lock-lamp" aria-hidden />
              <span className="min-w-0 text-left">
                <span className="area-lock-title">
                  Lock scene globals
                  <span className="area-lock-state">
                    {session.lockGlobals === true ? "ON" : "OFF"}
                  </span>
                </span>
                <span className="area-lock-sub">
                  {session.lockGlobals === true
                    ? "Per-area pass — camera + local lights only."
                    : "Big project? Match globals on a hero shot, then lock them here."}
                </span>
              </span>
            </button>
            <button
              className="btn btn-primary btn-analyze w-full"
              disabled={!analyzeReady || inFlight}
              onClick={doAnalyze}
              data-busy={inFlight}
            >
              {inFlight ? (
                <>
                  <Spinner /> Analyzing…
                </>
              ) : (
                <>{hasRecipe ? "Re-analyze" : "Analyze the match"}</>
              )}
            </button>

            {!analyzeReady ? (
              <p className="text-[0.72rem] text-[oklch(0.83_0.012_80)] mt-2.5 text-center leading-snug">
                Add a reference and a base render to begin.
              </p>
            ) : !inFlight ? (
              <p className="text-[0.72rem] text-[oklch(0.83_0.012_80)] mt-2.5 text-center leading-snug">
                Returns an exact {session.activeTarget === "vray7max" ? "V-Ray 7" : "Chaos Vantage 3.3"} recipe.
              </p>
            ) : null}

            {refining && (
              <div className="mt-3 pt-3 border-t border-[var(--color-chrome-line)]">
                <button
                  className="btn-alt-target w-full"
                  disabled={inFlight}
                  onClick={doReanalyzeOther}
                >
                  <span className="btn-alt-target__lead" aria-hidden>+</span>
                  <span>Also match for {otherTarget}</span>
                </button>
              </div>
            )}
          </div>
        </Step>
      </div>
    </div>
  );
}

// A step in the control rail. Steps read as one continuous instrument column: a spine
// of numbered nodes joined by a hairline connector, each step a recessed cell. Not a
// stack of identical cards — a sequence. --------------------------------------------
function Step({
  n,
  title,
  sub,
  tone,
  first,
  last,
  children,
}: {
  n: number;
  title: string;
  sub?: string;
  tone?: "key";
  first?: boolean;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-x-3">
      {/* the connector spine + numbered node */}
      <div className="relative flex flex-col items-center">
        {!first && <span className="absolute -top-3 h-3 w-px bg-[var(--color-chrome-line)]" aria-hidden />}
        <span
          className={`relative z-[1] grid place-items-center w-6 h-6 rounded-full text-[0.72rem] font-bold flex-none ${
            tone === "key"
              ? "bg-[var(--color-accent)] text-[oklch(0.27_0.09_62)] shadow-[var(--shadow-accent)]"
              : "bg-[var(--color-surface)] text-[var(--color-accent-ink)] border border-[var(--color-accent-line)]"
          }`}
        >
          {n}
        </span>
        {!last && <span className="flex-1 w-px bg-[var(--color-chrome-line)] mt-1" aria-hidden />}
      </div>

      <div className={`min-w-0 ${last ? "pb-0.5" : "pb-4"}`}>
        <div className="mb-2.5 pt-0.5">
          <h3 className="text-[0.92rem] font-[640] text-[oklch(0.95_0.01_82)] leading-tight tracking-[-0.01em]">{title}</h3>
          {sub && <p className="text-[0.72rem] text-[oklch(0.84_0.012_80)] leading-snug mt-0.5">{sub}</p>}
        </div>
        <div className="rail-cell p-2.5 sm:p-3">{children}</div>
      </div>
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
