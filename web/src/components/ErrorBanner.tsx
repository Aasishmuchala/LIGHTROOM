"use client";

import type { LastError } from "@/store/useEngine";
import { errorBannerCopy } from "./lib";

// Recognizable, not loud. Each typed error kind gets a calm, specific line — chosen
// by the PURE errorBannerCopy in components/lib (extracted so the wording contracts,
// e.g. the auth no-key-vs-rejected split, are pinned by tests). The banner sits
// inline (a tinted well), never a full-bleed alarm. --------------------------------
export function ErrorBanner({ error }: { error: LastError | null }) {
  if (!error) return null;
  const { title, detail, raw } = errorBannerCopy(error);
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
