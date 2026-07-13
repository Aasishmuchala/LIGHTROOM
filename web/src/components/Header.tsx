"use client";

import { useEffect, useRef, useState } from "react";
import { engineStore, useEngine } from "@/store/useEngine";
import { STORE } from "@/lib/store";
import { TARGETS } from "./lib";
import { SetupMenu } from "./SetupMenu";
import { SessionsMenu } from "./SessionsMenu";

// The wordmark IS the instrument's axis: a little ivory meter face with a marigold
// needle, then the wordmark set tight. Reads as a light-meter faceplate. -----------
function Wordmark() {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <span aria-hidden className="lm-needle" />
      <div className="leading-none">
        <div
          className="text-[1.06rem] font-[750] tracking-[-0.01em] text-[oklch(0.955_0.008_84)]"
          style={{ textShadow: "0 1px 0 oklch(0.2 0.01 60 / 0.55), 0 -1px 0 oklch(1 0 0 / 0.12)" }}
        >
          Light<span className="text-[var(--color-accent-hi)]">Match</span>
        </div>
        <div className="mt-[3px] text-[0.5rem] font-semibold uppercase tracking-[0.24em] text-[oklch(0.90_0.012_80)]">
          exposure · reference matcher
        </div>
      </div>
    </div>
  );
}

// Slim command bar. Only the two things that change per session live here at full
// weight — the target renderer and the API key — plus a compact Setup gear for the
// set-and-forget controls (model, consensus, import/export). The old header carried
// all six at once, which read as an undifferentiated wall of knobs. ----------------
export function Header() {
  const target = useEngine((s) => s.session.activeTarget);
  const [hasKey, setHasKey] = useState(false);
  const [keyEditing, setKeyEditing] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
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
  const onKeyCommit = () => {
    const v = keyRef.current?.value.trim() || "";
    if (v && !v.startsWith("•")) {
      STORE.setKey(v);
      setHasKey(true);
      flashMsg("Key stored in this browser.");
    }
    setKeyEditing(false);
  };

  return (
    <header className="relative mb-4 border-b border-[var(--color-chrome-line)] shadow-[0_1px_0_oklch(1_0_0_/_0.12)]">
      <div className="px-2 sm:px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        {/* LEFT: identity + the per-session renderer choice */}
        <div className="flex items-center gap-x-3 gap-y-2 min-w-0 flex-wrap">
          <Wordmark />
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

        <div className="hidden sm:block flex-1" />

        {/* RIGHT: the key (gates analyze, so it stays visible) + Setup gear */}
        <div className="flex items-center gap-x-2.5 gap-y-2 w-full sm:w-auto min-w-0">
          {flash && (
            <span className="hidden md:inline text-[0.72rem] font-medium text-[var(--color-accent-hi)] animate-fade whitespace-nowrap">
              {flash}
            </span>
          )}
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
              title={hasKey ? "Key stored" : "No key set — paste your oc_ key to analyze"}
            />
            <input
              ref={keyRef}
              type="password"
              className="field w-full min-w-0 sm:!w-[9.5rem] !py-1.5 text-[0.78rem]"
              placeholder="oc_… key"
              defaultValue={hasKey && !keyEditing ? "••••••••••" : ""}
              onFocus={(e) => {
                setKeyEditing(true);
                if (e.target.value.startsWith("•")) e.target.value = "";
              }}
              onBlur={onKeyCommit}
              aria-label="API key"
            />
          </form>

          <SessionsMenu onFlash={flashMsg} />
          <SetupMenu onFlash={flashMsg} />
        </div>
      </div>
    </header>
  );
}
