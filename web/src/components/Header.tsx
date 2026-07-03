"use client";

import { useEffect, useRef, useState } from "react";
import { engineStore, useEngine } from "@/store/useEngine";
import { STORE } from "@/lib/store";
import { MODELS, TARGETS } from "./lib";

// The wordmark carries the identity: "Light" with a spectrum underline that IS the
// warm→cool light axis the tool works on. Bright, distinctive, unmistakably about
// light — not a generic SaaS logotype. --------------------------------------------
function Wordmark() {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <span aria-hidden className="relative grid place-items-center w-8 h-8 rounded-[10px] shadow-[var(--shadow-sm)] overflow-hidden bg-[var(--color-surface)] border border-[var(--color-line)]">
        {/* a tiny sun over a spectrum horizon — the product mark */}
        <span className="absolute inset-x-0 bottom-0 h-3 spectrum-bar opacity-90" />
        <span className="absolute w-3 h-3 rounded-full bg-[var(--color-accent)] shadow-[0_0_10px_var(--color-accent)] top-1.5" />
      </span>
      <div className="leading-none">
        <div className="text-[1.05rem] font-[680] tracking-[-0.02em] text-[var(--color-ink)]">
          Light<span className="text-[var(--color-accent-ink)]">Match</span>
        </div>
      </div>
    </div>
  );
}

export function Header() {
  const target = useEngine((s) => s.session.activeTarget);
  const [model, setModel] = useState<string>("claude-opus-4-8");
  const [hasKey, setHasKey] = useState(false);
  const [keyEditing, setKeyEditing] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Hydrate localStorage-backed prefs on the client only (SSR-safe: STORE returns
  // defaults on the server, real values here).
  useEffect(() => {
    setModel(STORE.prefs().model);
    setHasKey(!!STORE.key());
  }, []);

  const flashMsg = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash((cur) => (cur === m ? null : cur)), 1600);
  };

  const onTarget = (t: string) => {
    STORE.setPrefs({ target: t });
    engineStore.getState().setActiveTarget(t);
  };
  const onModel = (m: string) => {
    setModel(m);
    STORE.setPrefs({ model: m });
  };
  const onKeyCommit = () => {
    const v = keyRef.current?.value.trim() || "";
    if (v && !v.startsWith("•")) {
      STORE.setKey(v);
      setHasKey(true);
      flashMsg("Key stored in this browser.");
    }
    setKeyEditing(false);
  };
  const onExport = async () => {
    const json = await engineStore.getState().exportJSON();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lightmatch-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flashMsg("Session exported.");
  };
  const onImportPick = () => importRef.current?.click();
  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      await engineStore.getState().importJSON(text);
      flashMsg("Session imported.");
    } catch (e) {
      flashMsg("Import failed: " + ((e as Error)?.message || "bad file"));
    }
  };

  return (
    <header
      className="sticky top-0 backdrop-blur-md bg-[oklch(0.983_0.006_240_/_0.82)] border-b border-[var(--color-line)]"
      style={{ zIndex: "var(--z-sticky)" as unknown as number }}
    >
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6">
        {/* Wraps gracefully: on narrow widths the right cluster drops below the
            wordmark+toggle. Never a fixed height (would clip the wrapped row). */}
        <div className="min-h-[62px] py-2.5 sm:py-0 flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-5">
          {/* LEFT: identity + target toggle. Stays together; toggle wraps under the
              wordmark only at the very smallest widths. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
            <Wordmark />

            {/* Target renderer toggle */}
            <div className="segmented" role="group" aria-label="Target renderer">
              {TARGETS.map((t) => (
                <button
                  key={t.value}
                  className="segmented-btn whitespace-nowrap"
                  data-on={target === t.value}
                  onClick={() => onTarget(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* pushes the right cluster to the far edge on one-line layouts */}
          <div className="hidden sm:block flex-1" />

          {/* RIGHT: model + key + session actions. Wraps to its own line under the
              left group when the viewport can't hold both; on the smallest widths this
              takes the full width and its own children wrap. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 w-full sm:w-auto min-w-0">
            {/* Model picker */}
            <select
              className="select hidden sm:block"
              aria-label="Model"
              value={model}
              onChange={(e) => onModel(e.target.value)}
            >
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>

            {/* API key — wrapped in a form so the browser knows the password field has a
                home; submit is prevented (there's nowhere to post). */}
            <form
              className="flex items-center gap-2 min-w-0 flex-1 sm:flex-none"
              onSubmit={(e) => {
                e.preventDefault();
                onKeyCommit();
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-none"
                style={{ background: hasKey ? "var(--color-good)" : "var(--color-line-strong)" }}
                title={hasKey ? "Key stored" : "No key set"}
              />
              <input
                ref={keyRef}
                type="password"
                className="field w-full min-w-0 sm:!w-[10rem] !py-1.5 text-[0.78rem]"
                placeholder="oc_…"
                defaultValue={hasKey && !keyEditing ? "••••••••••" : ""}
                onFocus={(e) => {
                  setKeyEditing(true);
                  if (e.target.value.startsWith("•")) e.target.value = "";
                }}
                onBlur={onKeyCommit}
                aria-label="API key"
              />
            </form>

            {/* Export / import — reachable at every width (labels stay whole; the row
                wraps rather than clipping them). */}
            <div className="flex items-center gap-1 flex-none">
              <button className="btn-ghost whitespace-nowrap" onClick={onExport} title="Export session as JSON">
                Export
              </button>
              <button className="btn-ghost whitespace-nowrap" onClick={onImportPick} title="Import a session JSON">
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
        </div>
      </div>

      {/* privacy line + flash */}
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 pb-1.5 -mt-0.5 flex items-center justify-end gap-3 flex-wrap">
        {flash && <span className="text-[0.72rem] text-[var(--color-accent-ink)] animate-fade">{flash}</span>}
        <span className="text-[0.7rem] text-[var(--color-faint)] text-right">
          Key & sessions: <span className="text-[var(--color-muted)]">Stored only in this browser.</span>
        </span>
      </div>
    </header>
  );
}
