"use client";

import { useRef } from "react";
import { engineStore, useEngine } from "@/store/useEngine";

// Shown only when IndexedDB is unavailable (private browsing, disabled storage, an
// open that rejected) and the store has degraded to an in-memory session with
// persistent === false. Calm and informational — an amber note, not a red alarm — it
// tells the user this browser won't keep sessions and points them at Export before
// they close. Export/Import are reachable right here so the warning is actionable.
export function StorageBanner({ onToast }: { onToast?: (m: string) => void }) {
  const persistent = useEngine((s) => s.storagePersistent);
  const importRef = useRef<HTMLInputElement>(null);

  if (persistent) return null;

  const toast = (m: string) => onToast?.(m);

  const onExport = async () => {
    const json = await engineStore.getState().exportJSON();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lightmatch-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Session exported.");
  };
  const onImportPick = () => importRef.current?.click();
  const onImportFile = async (file: File) => {
    try {
      await engineStore.getState().importJSON(await file.text());
      toast("Session imported.");
    } catch (e) {
      toast("Import failed: " + ((e as Error)?.message || "bad file"));
    }
  };

  return (
    <div
      role="status"
      data-storage-warning
      className="rounded-[var(--radius-card)] border p-3.5 flex gap-3 animate-fade"
      style={{ borderColor: "var(--color-line-strong)", background: "var(--color-warn-tint)" }}
    >
      <span
        className="flex-none mt-px grid place-items-center w-5 h-5 rounded-full text-[0.72rem] font-bold"
        style={{ background: "var(--color-warn)", color: "oklch(0.28 0.07 62)" }}
        aria-hidden
      >
        !
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[0.85rem] font-semibold text-[var(--color-ink)]">
          This browser won’t save your session
        </div>
        <p className="text-[0.8rem] text-[var(--color-ink-2)] mt-0.5 leading-snug max-w-[72ch]">
          Storage is unavailable here (often private/incognito mode), so LightMatch is running from
          memory — your work will be lost when you close this tab. Export it first if you want to keep it,
          and Import it back next time.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className="btn-mini" onClick={onExport}>
            Export session
          </button>
          <button className="btn-mini" onClick={onImportPick}>
            Import session
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
    </div>
  );
}
