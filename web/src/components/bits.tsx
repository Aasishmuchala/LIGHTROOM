"use client";

import { splitPath } from "./lib";

// -- ui_path breadcrumb: segments recede, leaf carries the weight. Text stays
// byte-identical to the verbatim ui_path. -----------------------------------------
export function PathBreadcrumb({ uiPath }: { uiPath: string }) {
  const { segs, leaf } = splitPath(uiPath);
  return (
    <span className="text-[0.82rem] leading-snug">
      {segs.map((s, i) => (
        <span key={i}>
          <span className="path-seg">{s}</span>
          <span className="path-sep">▸</span>
        </span>
      ))}
      <span className="path-leaf">{leaf}</span>
    </span>
  );
}

// -- confidence dot. --------------------------------------------------------------
export function ConfDot({ confidence }: { confidence?: string }) {
  const c = confidence === "high" ? "conf-high" : confidence === "low" ? "conf-low" : "conf-medium";
  return <span className={`conf-dot ${c}`} title={`confidence: ${confidence || "medium"}`} />;
}

// -- the from → to jewel (or a placement instruction). ----------------------------
export function ValueJewel({
  from,
  value,
  unit,
  kind,
}: {
  from?: number | string;
  value: number | string;
  unit?: string;
  kind: string;
}) {
  const isPlacement = kind === "placement";
  const u = unit && typeof value === "number" ? unit : "";
  if (isPlacement) {
    return (
      <span className="jewel jewel-to text-[0.82rem]">{String(value)}</span>
    );
  }
  return (
    <span className="jewel text-[0.82rem] inline-flex items-center gap-1.5">
      {from !== undefined && <span className="jewel-from">{String(from)}</span>}
      {from !== undefined && <span className="jewel-arrow" aria-hidden>→</span>}
      <span className="jewel-to">
        {String(value)}
        {u && <span className="text-[0.68rem] text-[var(--color-muted)] ml-0.5 font-normal">{u}</span>}
      </span>
    </span>
  );
}

// -- clamped flag. ----------------------------------------------------------------
export function ClampedFlag({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span
      className="text-[0.62rem] font-semibold uppercase tracking-wide text-[var(--color-warn)] bg-[var(--color-accent-tint)] rounded px-1 py-px"
      title="Clamped to the parameter's legal range"
    >
      clamped
    </span>
  );
}

// -- transient toast. -------------------------------------------------------------
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      className="fixed bottom-5 left-1/2 -translate-x-1/2 animate-rise"
      style={{ zIndex: "var(--z-toast)" as unknown as number }}
      role="status"
    >
      <div className="rounded-full bg-[var(--color-ink)] text-white text-[0.8rem] font-medium px-4 py-2 shadow-[var(--shadow-lg)]">
        {message}
      </div>
    </div>
  );
}
