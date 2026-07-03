"use client";

import type { LastError } from "@/store/useEngine";
import { REJECT_MESSAGE } from "./lib";

// Recognizable, not loud. Each typed error kind gets a calm, specific line. The
// banner sits inline (a tinted well), never a full-bleed alarm. -------------------
function messageFor(err: LastError): { title: string; detail: string; raw?: string } {
  switch (err.kind) {
    case "auth":
      return { title: "Key rejected", detail: "The gateway returned 401. Check your oc_ key and try again." };
    case "network":
      return { title: "Gateway unreachable", detail: "The request timed out or the network dropped. It was retried 3 times." };
    case "truncated":
      return { title: "Response cut short", detail: "The model hit its token cap mid-recipe. Try again, or narrow the scene context." };
    case "shape":
      return {
        title: "Unexpected response",
        detail: "The model replied without a structured recipe. This is usually transient; try Analyze again.",
        raw: err.raw,
      };
    case "invalid":
      return { title: "Recipe failed validation", detail: err.message || "The model's recipe didn't fit the pack contract, twice." };
    case "decode":
      return { title: "Couldn't read that image", detail: err.message || REJECT_MESSAGE };
    case "busy":
      return { title: "Already working", detail: "An analyze or refine call is in flight. One moment." };
    default:
      return { title: "Something went wrong", detail: err.message || "An unexpected error occurred." };
  }
}

export function ErrorBanner({ error }: { error: LastError | null }) {
  if (!error) return null;
  const { title, detail, raw } = messageFor(error);
  const isDecode = error.kind === "decode";
  return (
    <div
      role="alert"
      data-error-kind={error.kind}
      className="rounded-[var(--radius-card)] border p-3.5 flex gap-3 animate-fade"
      style={{
        borderColor: "var(--color-danger)",
        background: "var(--color-danger-tint)",
      }}
    >
      <span
        className="flex-none mt-px grid place-items-center w-5 h-5 rounded-full text-[0.7rem] font-bold text-white"
        style={{ background: "var(--color-danger)" }}
        aria-hidden
      >
        {isDecode ? "?" : "!"}
      </span>
      <div className="min-w-0">
        <div className="text-[0.85rem] font-semibold text-[var(--color-ink)]">{title}</div>
        <div className="text-[0.8rem] text-[var(--color-ink-2)] mt-0.5 leading-snug">{detail}</div>
        {raw && (
          <details className="mt-1.5">
            <summary className="text-[0.72rem] text-[var(--color-muted)] hover:text-[var(--color-ink-2)] inline-flex items-center gap-1">
              <span className="caret text-[0.6rem]">▸</span> raw response
            </summary>
            <pre className="mt-1 text-[0.68rem] font-mono text-[var(--color-muted)] whitespace-pre-wrap break-all max-h-40 overflow-auto bg-[var(--color-surface)] rounded p-2 border border-[var(--color-line)]">
              {raw.slice(0, 2000)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
