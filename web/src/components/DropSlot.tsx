"use client";

import { useRef, useState } from "react";
import { safeSrc } from "./lib";

// One image port. Clicking anywhere on it opens the native file picker (the standard
// drop-zone affordance); it also accepts drag-drop and Ctrl+V paste. The click also
// sets focus so a subsequent paste routes here (paste is wired globally in the page,
// which reads `focusedSlot`). Shows a thumbnail when filled. -----------------------
export function DropSlot({
  slotKey,
  label,
  hint,
  dataUrl,
  focused,
  onFocus,
  onFile,
  compact,
  captionOverride,
  exrEv,
  onExrEv,
}: {
  slotKey: string;
  label: string;
  hint?: string;
  dataUrl?: string | null;
  focused: boolean;
  onFocus: () => void;
  onFile: (file: File) => void;
  compact?: boolean;
  captionOverride?: string;
  /** When this slot ingested an EXR: the current develop EV (else null/undefined). */
  exrEv?: number | null;
  /** Called (debounced by the browser's input events) when the user drags the EV slider. */
  onExrEv?: (ev: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const src = dataUrl ? safeSrc(dataUrl) : "";
  const isExr = typeof exrEv === "number" && !!onExrEv;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label}: click to choose a file, or drop / paste an image`}
      onClick={() => {
        onFocus();
        inputRef.current?.click();
      }}
      onFocus={onFocus}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={[
        "group relative rounded-[var(--radius-card)] cursor-pointer transition-all",
        "border overflow-hidden text-left",
        compact ? "" : "",
        src ? "border-[var(--color-line)] bg-[var(--color-surface)]" : "border-dashed bg-[var(--color-surface-2)]",
        dragOver
          ? "border-[var(--color-accent)] bg-[var(--color-accent-tint)] scale-[1.01]"
          : focused && !src
            ? "border-[var(--color-accent-line)] ring-2 ring-[var(--color-accent-tint)]"
            : "border-[var(--color-line-strong)] hover:border-[var(--color-accent-line)]",
      ].join(" ")}
      style={{ transitionDuration: "var(--dur)", transitionTimingFunction: "var(--ease-out)" }}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <span className="text-[0.78rem] font-semibold text-[var(--color-ink)]">
          {label}
          {hint && <span className="ml-1.5 font-normal text-[0.7rem] text-[var(--color-faint)]">({hint})</span>}
        </span>
        {src && (
          <span className="text-[0.62rem] font-medium text-[var(--color-good)] flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-good)]" /> loaded
          </span>
        )}
      </div>

      <div className={`px-3 pb-3 pt-2 ${compact ? "" : ""}`}>
        {src ? (
          <div className="relative rounded-[10px] overflow-hidden bg-[var(--color-canvas-deep)] border border-[var(--color-line)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={label}
              className={`w-full object-cover ${compact ? "h-16" : "h-24"}`}
            />
            {isExr && (
              <span
                className="absolute top-1.5 left-1.5 text-[0.6rem] font-semibold tracking-[0.02em] text-white bg-black/55 rounded px-1.5 py-0.5 backdrop-blur-sm flex items-center gap-1"
                title="This EXR was decoded and tone-mapped to a viewable sRGB exposure."
              >
                <span className="w-1.5 h-1.5 rounded-full spectrum-bar" aria-hidden />
                EXR · developed
              </span>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-end p-1.5">
              <span className="text-[0.62rem] font-medium text-white bg-black/50 rounded px-1.5 py-0.5 backdrop-blur-sm">
                replace
              </span>
            </div>
          </div>
        ) : (
          <div
            className={`rounded-[10px] grid place-items-center text-center ${compact ? "h-16" : "h-24"} bg-[var(--color-canvas-deep)]`}
          >
            <div className="px-2">
              <div className="text-[0.72rem] text-[var(--color-muted)] leading-snug">
                {captionOverride || "Drop, paste, or choose a file"}
              </div>
              <div className="text-[0.62rem] text-[var(--color-faint)] mt-0.5">PNG · JPG · WebP · EXR</div>
            </div>
          </div>
        )}

        {/* Exposure control — only for an EXR-developed slot. Re-develops the preview from
            the retained linear buffer and re-measures on every change (instant, client-
            side), so the user can match what they saw in the VFB. Stops propagation so
            dragging never triggers the port's focus/replace click. */}
        {isExr && (
          <div
            className="mt-2.5 rounded-[9px] bg-[var(--color-surface-2)] border border-[var(--color-line)] px-2.5 py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor={`exr-ev-${slotKey}`}
                className="text-[0.62rem] font-semibold uppercase tracking-[0.06em] text-[var(--color-faint)]"
              >
                Exposure
              </label>
              <span className="jewel text-[0.68rem] text-[var(--color-accent-ink)] font-semibold tabular-nums">
                {(exrEv as number) >= 0 ? "+" : ""}
                {(exrEv as number).toFixed(2)} EV
              </span>
            </div>
            <input
              id={`exr-ev-${slotKey}`}
              type="range"
              min={-5}
              max={5}
              step={0.1}
              value={exrEv as number}
              aria-label={`${label} exposure in stops`}
              className="exr-ev-slider w-full"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => onExrEv?.(parseFloat(e.target.value))}
            />
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,.exr,image/x-exr"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
