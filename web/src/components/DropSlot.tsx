"use client";

import { useRef, useState } from "react";
import { safeSrc } from "./lib";

// One image port. Supports drag-drop, click-to-focus (so a subsequent paste routes
// here), and a file picker. Shows a thumbnail when filled. The paste itself is wired
// globally in the page (document-level), which reads `focusedSlot`. ----------------
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
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const src = dataUrl ? safeSrc(dataUrl) : "";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label}: drop, click to focus and paste, or choose a file`}
      onClick={onFocus}
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
              <div className="text-[0.62rem] text-[var(--color-faint)] mt-0.5">PNG · JPG · WebP</div>
            </div>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
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
