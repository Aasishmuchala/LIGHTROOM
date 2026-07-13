"use client";

import { useEffect, useRef, useState } from "react";
import { createEvCommitQueue, safeSrc, type EvCommitQueue } from "./lib";

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
  large,
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
  /** A primary input (Reference / Base): taller preview, larger label, more room. */
  large?: boolean;
  captionOverride?: string;
  /** When this slot ingested an EXR: the current develop EV (else null/undefined). */
  exrEv?: number | null;
  /** Called with the newest EV once a drag pauses (trailing-debounced + serialized
   *  HERE via createEvCommitQueue — a full-res redevelop per 0.1-EV tick was finding
   *  C5). Return the engine promise so commits queue instead of overlapping. */
  onExrEv?: (ev: number) => void | Promise<unknown>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // -- EV slider commit path (C5): the visible value is echoed locally so dragging
  // feels instant, while the expensive engine commit (full-res redevelop + re-measure
  // + persist) trails through the queue — one commit per drag pause, never
  // overlapping, always the newest EV. The latest-callback ref keeps the queue's
  // sink current without recreating the queue; refs are only touched from effects
  // and event handlers (never during render, per the hooks contract). ---------------
  const onExrEvRef = useRef(onExrEv);
  useEffect(() => {
    onExrEvRef.current = onExrEv;
  });
  const evQueueRef = useRef<EvCommitQueue | null>(null);
  /** The slot's commit queue, created lazily on the first drag tick. */
  const evQueue = (): EvCommitQueue => {
    if (evQueueRef.current == null) {
      evQueueRef.current = createEvCommitQueue((ev) => onExrEvRef.current?.(ev));
    }
    return evQueueRef.current;
  };
  const [echoEv, setEchoEv] = useState<number | null>(null); // live drag value, uncommitted
  // When a commit lands (exrEv moves) and nothing newer is queued or in flight, the
  // store's value IS the truth — drop the echo so it (and any external EV change,
  // e.g. a replaced EXR's fresh auto-exposure) shows through again.
  useEffect(() => {
    if (echoEv !== null && !evQueueRef.current?.pending()) setEchoEv(null);
  }, [exrEv, echoEv]);
  // Unmount: drop any queued commit (an in-flight one finishes; its result is valid).
  useEffect(() => {
    return () => {
      evQueueRef.current?.cancel();
    };
  }, []);
  const src = dataUrl ? safeSrc(dataUrl) : "";
  const isExr = typeof exrEv === "number" && !!onExrEv;
  // What the slider + readout show: the live drag echo while a commit trails, the
  // store's committed EV otherwise.
  const liveEv = isExr ? echoEv ?? (exrEv as number) : 0;
  // Preview height by role: primary ports (Reference / Base) get a tall, confident
  // thumbnail; the compact settings variant is retired but kept for safety.
  const previewH = large ? "h-36 sm:h-40" : compact ? "h-16" : "h-24";

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
        "group relative cursor-pointer transition-all text-left gauge-win",
        dragOver ? "is-drop scale-[1.01]" : focused && !src ? "is-drop" : "",
      ].join(" ")}
      style={{ transitionDuration: "var(--dur)", transitionTimingFunction: "var(--ease-out)" }}
    >
      <div className={`flex justify-between gap-2 px-1.5 ${large ? "items-start pt-1" : "items-center pt-0.5"}`}>
        {large ? (
          <span className="min-w-0 flex flex-col gap-0.5">
            <span className="text-[0.9rem] font-[640] text-[var(--color-ink)] tracking-[-0.01em] leading-none">
              {label}
            </span>
            {hint && (
              <span className="text-[0.72rem] font-normal text-[var(--color-ink-2)] leading-none">
                {hint}
              </span>
            )}
          </span>
        ) : (
          <span className="text-[0.78rem] font-[620] text-[var(--color-ink)] tracking-[-0.01em]">
            {label}
            {hint && (
              <span className="ml-1.5 font-normal text-[0.7rem] text-[var(--color-ink-2)]">({hint})</span>
            )}
          </span>
        )}
        {src && (
          <span className="text-[0.6rem] font-semibold uppercase tracking-[0.05em] text-[oklch(0.40_0.12_162)] flex items-center gap-1 flex-none">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-good)]" /> loaded
          </span>
        )}
      </div>

      <div className={`px-1.5 pb-1.5 ${large ? "pt-2" : "pt-1.5"}`}>
        {src ? (
          <div className="gauge-glass relative overflow-hidden bg-[var(--color-canvas-deep)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={label}
              className={`w-full object-cover ${previewH}`}
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
            className={`gauge-glass grid place-items-center text-center ${previewH} bg-[var(--color-canvas-deep)]`}
          >
            <div className="px-2 flex flex-col items-center">
              {large && (
                <span
                  className="mb-2 grid place-items-center w-8 h-8 rounded-full bg-[oklch(0.46_0.01_70)] text-[oklch(0.86_0.01_82)] shadow-[0_1px_2px_oklch(0.15_0.01_60_/_0.5),inset_0_1px_0_oklch(1_0_0_/_0.14)] group-hover:text-[var(--color-accent-hi)] transition-colors"
                  aria-hidden
                  style={{ transitionDuration: "var(--dur)" }}
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3.5v9M3.5 8h9" />
                  </svg>
                </span>
              )}
              <div className={`text-[oklch(0.74_0.012_78)] leading-snug ${large ? "text-[0.76rem] font-medium" : "text-[0.72rem]"}`}>
                {captionOverride || "Insert a frame"}
              </div>
              <div className="mt-1.5 text-[0.58rem] font-medium uppercase tracking-[0.1em] text-[oklch(0.6_0.012_74)]">PNG · JPG · WebP · EXR</div>
            </div>
          </div>
        )}

        {/* Exposure control — only for an EXR-developed slot. The slider value tracks
            the drag instantly (local echo); the actual redevelop + re-measure of the
            retained linear buffer commits through the trailing queue (one full-res
            develop per pause, serialized — finding C5), so the user can match what
            they saw in the VFB without the drag hitching. Stops propagation so
            dragging never triggers the port's focus/replace click. */}
        {isExr && (
          <div
            className="mt-2.5 rounded-[9px] bg-[var(--color-surface-2)] border border-[var(--color-line)] px-2.5 py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor={`exr-ev-${slotKey}`}
                className="text-[0.62rem] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]"
              >
                Exposure
              </label>
              <span className="jewel text-[0.68rem] text-[var(--color-accent-ink)] font-semibold tabular-nums">
                {liveEv >= 0 ? "+" : ""}
                {liveEv.toFixed(2)} EV
              </span>
            </div>
            <input
              id={`exr-ev-${slotKey}`}
              type="range"
              min={-5}
              max={5}
              step={0.1}
              value={liveEv}
              aria-label={`${label} exposure in stops`}
              className="exr-ev-slider w-full"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const ev = parseFloat(e.target.value);
                setEchoEv(ev); // the readout + thumb move NOW …
                evQueue().request(ev); // … the redevelop commits on the pause
              }}
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
