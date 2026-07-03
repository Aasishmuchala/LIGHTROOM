"use client";

// Busy state: a skeleton that matches the recipe layout's shape (changes hero +
// rows), with the signature spectrum bar sweeping — never a bare spinner. ----------
export function AnalyzingState() {
  return (
    <div className="card overflow-hidden animate-fade">
      <div className="h-1.5 spectrum-bar analyzing-sweep" />
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-block w-4 h-4 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
          <span className="text-[0.92rem] font-[600] text-[var(--color-ink)]">Reading the light…</span>
        </div>
        <p className="text-[0.8rem] text-[var(--color-muted)] mt-1.5 max-w-[56ch]">
          Measuring both frames, then translating the gap into exact moves in your renderer’s vocabulary.
        </p>

        <div className="mt-5 flex items-center gap-2">
          <div className="skeleton h-9 w-14 rounded-lg" />
          <div className="skeleton h-5 w-64" />
        </div>
        <div className="mt-4 flex flex-col gap-2.5">
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

// Ready state: both frames in, no recipe yet — a calm prompt to press Analyze. -----
export function ReadyState({ target }: { target: string }) {
  const label = target === "vantage33" ? "Chaos Vantage 3.3" : "V-Ray 7";
  return (
    <div className="card overflow-hidden animate-rise">
      <div className="h-1.5 spectrum-bar" />
      <div className="px-6 py-10 text-center">
        <div className="mx-auto grid place-items-center w-14 h-14 rounded-full bg-[var(--color-accent-tint)] mb-4">
          <span className="text-[1.5rem]" aria-hidden>◐</span>
        </div>
        <h2 className="text-[1.2rem] font-[680] text-[var(--color-ink)]">Both frames are in.</h2>
        <p className="text-[0.88rem] text-[var(--color-muted)] mt-2 max-w-[46ch] mx-auto leading-relaxed">
          Press <strong className="text-[var(--color-ink)]">Analyze the match</strong> on the left and
          LightMatch will return an exact {label} lighting recipe, leading with the changes to make.
        </p>
      </div>
    </div>
  );
}
