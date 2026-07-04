"use client";

// Busy state: a skeleton that matches the recipe layout's shape (hero numeral +
// calibration read-out + ledger rows), with the signature spectrum sweeping on the
// scale — never a bare spinner. -----------------------------------------------------
export function AnalyzingState() {
  return (
    <div className="work-card work-card--hero overflow-hidden animate-fade">
      <div className="px-5 pt-4 pb-3 border-b border-[var(--color-line)] flex items-center gap-2.5">
        <span className="inline-block w-4 h-4 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
        <span className="text-[0.92rem] font-[640] text-[var(--color-ink)] tracking-[-0.01em]">Reading the light…</span>
      </div>
      <div className="px-5 pt-5 pb-4">
        <p className="text-[0.8rem] text-[var(--color-muted)] max-w-[56ch] leading-snug">
          Measuring both frames, then translating the gap into exact moves in your renderer’s vocabulary.
        </p>

        {/* hero numeral placeholder + label */}
        <div className="mt-5 flex items-center gap-4">
          <div className="skeleton h-14 w-16 rounded-[10px]" />
          <div className="flex-1 flex flex-col gap-2">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-3 w-1/2" />
          </div>
        </div>

        {/* the calibration scale sweeping */}
        <div className="mt-5 calib-scale analyzing-sweep" />

        {/* ledger rows */}
        <div className="mt-5 flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton h-2 w-2 !rounded-full" />
              <div className="flex-1">
                <div className="skeleton h-3.5 w-1/2" />
                <div className="skeleton h-2.5 w-2/3 mt-1.5" />
              </div>
              <div className="skeleton h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Ready state: both frames in, no recipe yet — a calm, decisive prompt to press
// Analyze. The mark is the spectrum axis with a marked key, echoing the empty-state
// bench so the identity carries through. --------------------------------------------
export function ReadyState({ target }: { target: string }) {
  const label = target === "vantage33" ? "Chaos Vantage 3.3" : "V-Ray 7";
  return (
    <div className="work-card work-card--hero overflow-hidden animate-rise">
      <div className="px-6 sm:px-9 py-10 sm:py-12 text-center flex flex-col items-center">
        <div className="w-40 max-w-full">
          <div className="relative h-2 rounded-full spectrum-bar shadow-[inset_0_0_0_1px_var(--color-line-strong)]">
            <span
              className="absolute top-1/2 left-1/2 w-3 h-3 rounded-full -translate-x-1/2 -translate-y-1/2 bg-[var(--color-surface)]"
              style={{ boxShadow: "0 0 0 3px var(--color-accent-strong), var(--shadow-sm)" }}
              aria-hidden
            />
          </div>
        </div>
        <span className="eyebrow mt-4">Both frames loaded</span>
        <h2 className="mt-2 text-[1.5rem] font-[720] tracking-[-0.03em] text-[var(--color-ink)]">
          Ready to read the light.
        </h2>
        <p className="text-[0.88rem] text-[var(--color-muted)] mt-2.5 max-w-[46ch] leading-relaxed">
          Press <strong className="text-[var(--color-ink)]">Analyze the match</strong> on the left and
          LightMatch will return an exact {label} lighting recipe, leading with the changes to make.
        </p>
      </div>
    </div>
  );
}
