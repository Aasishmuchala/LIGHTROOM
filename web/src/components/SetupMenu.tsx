"use client";

// SetupMenu — the "settings" the artist touches once and forgets: model, Consensus ×3,
// and session Export / Import. These used to crowd the header beside the per-session
// controls (target, key), which made the bar read as a wall of equal-weight knobs.
// Pulling the set-and-forget ones behind a gear popover leaves the bar with only what
// changes per session. A fixed-position panel (not an absolute dropdown) so it can
// never be clipped by a parent's radius/stacking context; closes on outside-click/Esc.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { engineStore } from "@/store/useEngine";
import { STORE } from "@/lib/store";
import { downloadText, MODELS } from "./lib";

export function SetupMenu({ onFlash }: { onFlash: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<string>("claude-opus-4-8");
  const [consensus, setConsensus] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setModel(STORE.prefs().model);
    setConsensus(STORE.prefs().consensus === true);
  }, []);

  // Position the panel under the trigger, right-aligned to it. Recomputed on open and
  // on resize/scroll while open so it tracks the trigger.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Close on outside pointerdown or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onModel = (m: string) => {
    setModel(m);
    STORE.setPrefs({ model: m });
  };
  const onConsensus = () => {
    const next = !consensus;
    setConsensus(next);
    STORE.setPrefs({ consensus: next });
  };
  const onExport = async () => {
    const json = await engineStore.getState().exportJSON();
    downloadText(`lightmatch-session-${Date.now()}.json`, json, "application/json");
    onFlash("Session exported.");
    setOpen(false);
  };
  const onImportFile = async (file: File) => {
    try {
      await engineStore.getState().importJSON(await file.text());
      onFlash("Session imported.");
    } catch (e) {
      onFlash("Import failed: " + ((e as Error)?.message || "bad file"));
    }
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`setup-trigger ${open ? "is-open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Setup — model, consensus, session import/export"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
          <circle cx="8" cy="8" r="2.1" />
          <path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4" strokeLinecap="round" />
        </svg>
        <span className="setup-trigger-label">Setup</span>
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Setup"
          className="setup-panel animate-rise"
          style={{ top: pos.top, right: pos.right }}
        >
          <div className="setup-row">
            <label className="setup-label" htmlFor="setup-model">
              Model
            </label>
            <select
              id="setup-model"
              className="select"
              value={model}
              onChange={(e) => onModel(e.target.value)}
            >
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="setup-row">
            <div className="min-w-0">
              <label className="setup-label" htmlFor="setup-consensus">
                Consensus ×3
              </label>
              <p className="setup-note">Three analyses merged — steadier values, 3× cost & time.</p>
            </div>
            <button
              id="setup-consensus"
              type="button"
              className="btn-chip flex-none"
              data-on={consensus}
              aria-pressed={consensus}
              onClick={onConsensus}
            >
              ×3
            </button>
          </div>

          <div className="setup-divider" />

          <div className="setup-row">
            <span className="setup-label">Session</span>
            <div className="flex items-center gap-1.5">
              <button className="btn-mini" onClick={onExport}>
                Export
              </button>
              <button className="btn-mini" onClick={() => importRef.current?.click()}>
                Import
              </button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImportFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
          <p className="setup-foot">Key &amp; sessions are stored only in this browser.</p>
        </div>
      )}
    </>
  );
}

export default SetupMenu;
