"use client";

// The teaching empty state — LightMatch's identity moment. Bright, distinctive, and
// obvious about what to do. The hero motif is the warm→cool light spectrum the tool
// works on: two frames (a warm reference, a cool base) resolving into a match. -----
export function EmptyState() {
  return (
    <div className="animate-rise">
      <div className="card overflow-hidden relative">
        {/* the signature spectrum band across the top */}
        <div className="h-1.5 spectrum-bar" />

        <div className="px-6 sm:px-10 pt-9 pb-8">
          {/* hero mark: two mismatched frames → one matched */}
          <HeroGlyph />

          <h1 className="mt-7 text-[1.75rem] sm:text-[2.1rem] font-[720] tracking-[-0.025em] leading-[1.08] text-[var(--color-ink)] max-w-[18ch]">
            Match your render’s light to{" "}
            <span className="text-[var(--color-accent-ink)]">any reference.</span>
          </h1>
          <p className="mt-3 text-[0.98rem] text-[var(--color-ink-2)] leading-relaxed max-w-[54ch]">
            Drop the look you want and your current render. LightMatch reads both frames and returns an
            exact, copy-able lighting recipe in your renderer’s own UI vocabulary, before a single color
            grade.
          </p>

          {/* the three-step path */}
          <ol className="mt-7 grid gap-3 sm:grid-cols-3">
            <PathCard
              n={1}
              title="Drop two frames"
              body={
                <>
                  The <strong className="text-[var(--color-ink)]">reference</strong> and your{" "}
                  <strong className="text-[var(--color-ink)]">base render</strong> into the ports on the
                  left.
                </>
              }
            />
            <PathCard
              n={2}
              title="Pick target & scene"
              body={
                <>
                  Choose V-Ray 7 or Vantage 3.3, set the scene, then press{" "}
                  <strong className="text-[var(--color-ink)]">Analyze</strong>.
                </>
              }
            />
            <PathCard
              n={3}
              title="Read, apply, refine"
              body={
                <>
                  Apply the changes, re-render, and drop the attempt back in to close the last few percent.
                </>
              }
            />
          </ol>
        </div>
      </div>

      {/* a quiet reassurance strip, not a pricing/version tell */}
      <div className="mt-3 flex items-center justify-center gap-2 text-[0.74rem] text-[var(--color-faint)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-good)]" />
        Runs entirely in your browser. Your images and key never leave this machine except to run the match.
      </div>
    </div>
  );
}

// Two frames — one warm/over, one cool/under — with a light-ray resolving them into
// a matched center. The visual metaphor for the whole tool, built from gradients (no
// external asset). ----------------------------------------------------------------
function HeroGlyph() {
  return (
    <div className="flex items-center gap-3 sm:gap-4" aria-hidden>
      <GlyphFrame
        label="reference"
        style={{
          background:
            "linear-gradient(135deg, var(--spectrum-warm), var(--spectrum-key) 55%, oklch(0.9 0.06 60))",
        }}
      />
      <div className="flex flex-col items-center gap-1">
        <svg width="46" height="20" viewBox="0 0 46 20" fill="none" className="text-[var(--color-accent)]">
          <path d="M2 10 H40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 4" />
          <path d="M34 4 L42 10 L34 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent-ink)]">
          match
        </span>
      </div>
      <GlyphFrame
        label="your render"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.62 0.06 250), var(--spectrum-cool) 60%, oklch(0.72 0.05 245))",
        }}
        dim
      />
    </div>
  );
}

function GlyphFrame({
  label,
  style,
  dim,
}: {
  label: string;
  style: React.CSSProperties;
  dim?: boolean;
}) {
  return (
    <div className="relative">
      <div
        className={`w-[104px] sm:w-[128px] aspect-[4/3] rounded-[12px] border border-white/40 shadow-[var(--shadow-md)] ${dim ? "opacity-90" : ""}`}
        style={style}
      >
        {/* a little "horizon + sun" so it reads as a lit scene */}
        <div className="absolute inset-x-2 bottom-2 h-px bg-white/50" />
        <div className={`absolute w-4 h-4 rounded-full ${dim ? "bg-white/40" : "bg-white/70"} blur-[1px] left-3 top-3`} />
      </div>
      <span className="block mt-1.5 text-center text-[0.62rem] font-medium text-[var(--color-faint)]">
        {label}
      </span>
    </div>
  );
}

function PathCard({ n, title, body }: { n: number; title: string; body: React.ReactNode }) {
  return (
    <li className="rounded-[var(--radius-control)] bg-[var(--color-surface-2)] border border-[var(--color-line)] p-3.5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="grid place-items-center w-5 h-5 rounded-full bg-[var(--color-accent-tint)] text-[var(--color-accent-ink)] text-[0.68rem] font-bold">
          {n}
        </span>
        <span className="text-[0.86rem] font-[600] text-[var(--color-ink)]">{title}</span>
      </div>
      <p className="text-[0.78rem] text-[var(--color-muted)] leading-snug">{body}</p>
    </li>
  );
}
