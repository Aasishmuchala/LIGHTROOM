"use client";

// The teaching empty state — LightMatch's identity moment. The hero is the tool's own
// instrument: the warm→cool light axis rendered as a measured bench, with the
// reference (warm) and the base render (cool) marked as points on it that a match
// pulls together. Built entirely from gradients + hairlines (no external asset). ----
export function EmptyState() {
  return (
    <div className="animate-rise flex flex-col gap-4">
      <div className="work-card work-card--hero overflow-hidden">
        <div className="px-6 sm:px-9 pt-8 pb-7">
          <span className="eyebrow">Match lighting · V-Ray 7 & Vantage 3.3</span>

          <h1 className="mt-3 text-[2rem] sm:text-[2.5rem] font-[760] tracking-[-0.035em] leading-[1.02] text-[var(--color-ink)] max-w-[16ch]">
            Match your render’s light to{" "}
            <span className="text-[var(--color-accent-ink)]">any reference.</span>
          </h1>
          <p className="mt-4 text-[0.98rem] text-[var(--color-ink-2)] leading-relaxed max-w-[56ch]">
            Drop the look you want and your current render. LightMatch reads both frames and returns an
            exact, copy-able lighting recipe in your renderer’s own UI vocabulary — before a single color
            grade.
          </p>

          {/* the instrument bench: reference and base as points on the light axis */}
          <LightBench />
        </div>

        {/* the three-step path — a sequence along the spine, not identical cards */}
        <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)] px-6 sm:px-9 py-6">
          <ol className="grid gap-x-8 gap-y-6 sm:grid-cols-3">
            <PathStep
              n={1}
              title="Drop two frames"
              body={
                <>
                  The <strong className="text-[var(--color-ink)]">reference</strong> and your{" "}
                  <strong className="text-[var(--color-ink)]">base render</strong>, into the ports on the
                  left.
                </>
              }
            />
            <PathStep
              n={2}
              title="Pick target & scene"
              body={
                <>
                  Choose V-Ray 7 or Vantage 3.3, set the scene, then press{" "}
                  <strong className="text-[var(--color-ink)]">Analyze</strong>.
                </>
              }
            />
            <PathStep
              n={3}
              title="Read, apply, refine"
              last
              body={
                <>
                  Apply the moves, re-render, and drop the attempt back in to close the last few percent.
                </>
              }
            />
          </ol>
        </div>
      </div>

      {/* a quiet reassurance strip, not a pricing/version tell */}
      <div className="flex items-center justify-center gap-2 text-[0.74rem] text-[oklch(0.80_0.012_78)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-good)]" />
        Runs entirely in your browser. Your images and key never leave this machine except to run the match.
      </div>
    </div>
  );
}

// The light bench: a single warm→cool spectrum axis with the reference marked at the
// warm key end and the base render at the cool end — the exact gap the tool closes.
function LightBench() {
  return (
    <div className="mt-8" aria-hidden>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[0.66rem] font-semibold uppercase tracking-[0.07em] text-[var(--spectrum-warm)]">
          warm · key
        </span>
        <span className="text-[0.62rem] font-semibold uppercase tracking-[0.09em] text-[var(--color-accent-ink)]">
          the match
        </span>
        <span className="text-[0.66rem] font-semibold uppercase tracking-[0.07em]" style={{ color: "var(--spectrum-cool)" }}>
          cool · shade
        </span>
      </div>

      {/* the axis */}
      <div className="relative h-2.5 rounded-full spectrum-bar shadow-[inset_0_0_0_1px_var(--color-line-strong)]">
        {/* reference marker — warm end */}
        <Marker pct={14} label="reference" tone="var(--spectrum-warm)" />
        {/* base render marker — cool end */}
        <Marker pct={84} label="your render" tone="var(--spectrum-cool)" />
        {/* the convergence tick at the match point */}
        <span
          className="absolute top-1/2 left-1/2 w-3 h-3 rounded-full -translate-x-1/2 -translate-y-1/2 bg-[var(--color-surface)]"
          style={{ boxShadow: "0 0 0 3px var(--color-accent-strong), var(--shadow-md)" }}
        />
      </div>

      <div className="relative h-9 mt-1">
        <MarkerLabel pct={14} label="reference" sub="the look you want" align="start" />
        <MarkerLabel pct={84} label="your render" sub="where you are now" align="end" />
      </div>
    </div>
  );
}

function Marker({ pct, tone }: { pct: number; label: string; tone: string }) {
  return (
    <span
      className="absolute top-1/2 w-2.5 h-2.5 rounded-full -translate-y-1/2 border-2 border-[var(--color-surface)]"
      style={{ left: `${pct}%`, transform: "translate(-50%,-50%)", background: tone, boxShadow: "var(--shadow-sm)" }}
    />
  );
}

function MarkerLabel({
  pct,
  label,
  sub,
  align,
}: {
  pct: number;
  label: string;
  sub: string;
  align: "start" | "end";
}) {
  return (
    <span
      className={`absolute top-0 flex flex-col ${align === "end" ? "items-end text-right" : "items-start text-left"}`}
      style={
        align === "end"
          ? { right: `${100 - pct}%`, transform: "translateX(50%)" }
          : { left: `${pct}%`, transform: "translateX(-50%)" }
      }
    >
      <span className="text-[0.72rem] font-[620] text-[var(--color-ink)] leading-none whitespace-nowrap">{label}</span>
      <span className="text-[0.62rem] text-[var(--color-faint)] mt-0.5 whitespace-nowrap">{sub}</span>
    </span>
  );
}

function PathStep({ n, title, body, last }: { n: number; title: string; body: React.ReactNode; last?: boolean }) {
  return (
    <li className="relative">
      <div className="flex items-center gap-2.5 mb-2">
        <span className="grid place-items-center w-6 h-6 rounded-full bg-[var(--color-surface)] border border-[var(--color-accent-line)] text-[var(--color-accent-ink)] text-[0.72rem] font-bold flex-none">
          {n}
        </span>
        <span className="text-[0.92rem] font-[640] text-[var(--color-ink)] tracking-[-0.01em]">{title}</span>
        {!last && (
          <span className="hidden sm:block flex-1 h-px bg-[var(--color-line-strong)] ml-1" aria-hidden />
        )}
      </div>
      <p className="text-[0.8rem] text-[var(--color-muted)] leading-snug pl-[2.15rem]">{body}</p>
    </li>
  );
}
