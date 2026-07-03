"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { engineStore, useEngine } from "@/store/useEngine";
import { Header } from "@/components/Header";
import { InputPanel } from "@/components/InputPanel";
import { EmptyState } from "@/components/EmptyState";
import { ReadyState, AnalyzingState } from "@/components/StatusStates";
import { RecipeView } from "@/components/RecipeView";
import { RefineLedger } from "@/components/RefineLedger";
import { ErrorBanner } from "@/components/ErrorBanner";
import { StorageBanner } from "@/components/StorageBanner";
import { Toast } from "@/components/bits";
import { routePaste, acceptsFile } from "@/components/lib";

export default function Home() {
  const state = useEngine((s) => s.state());
  const inFlight = useEngine((s) => !!s._inFlight);
  const lastError = useEngine((s) => s.lastError);
  const session = useEngine((s) => s.session);
  const chain = useEngine((s) => s.activeChain());

  const [focusedSlot, setFocusedSlot] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedRef = useRef<string | null>(null);
  focusedRef.current = focusedSlot;

  const showToast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // Boot: hydrate the latest saved session from IndexedDB on mount.
  useEffect(() => {
    engineStore.getState().boot();
  }, []);

  // Dev-only testability bridge: expose the engine store so a driver (Playwright /
  // preview eval) can stub the model-call seam and drive a match without a real key.
  // Never present in a production build.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __lmEngine?: typeof engineStore }).__lmEngine = engineStore;
    }
  }, []);

  // Global paste: route a pasted image to the right slot (or a new attempt). Uses the
  // same pure routePaste the drop path uses; reads focus via a ref so the listener is
  // installed once.
  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      const items = ev.clipboardData?.items;
      if (!items) return;
      let file: File | null = null;
      for (const it of items) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          file = it.getAsFile();
          break;
        }
      }
      if (!file) return;
      ev.preventDefault();

      const s = engineStore.getState();
      const sess = s.session;
      const st = s.state();
      const filled = {
        ref: !!sess.ref,
        base: !!sess.base,
        settings: !!sess.settingsShot,
      };
      const slot = routePaste(st, focusedRef.current, filled);
      if (!slot) {
        showToast("Click a port first, then paste.");
        return;
      }
      const check = acceptsFile(file);
      if (!check.ok) {
        showToast(check.reason);
        return;
      }
      (async () => {
        try {
          if (slot === "attempt") {
            const { score } = await s.addAttempt(file!);
            showToast(`Attempt scored. Look distance ${Math.round(score)}.`);
          } else {
            await s.setImage(slot, file!);
            showToast(`Pasted into ${slot === "ref" ? "Reference" : slot === "base" ? "Base render" : "Settings"}.`);
          }
          setFocusedSlot(null);
        } catch {
          /* store records lastError */
        }
      })();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [showToast]);

  const hasRecipe = !!(chain && chain.recipe);
  const hasAttempts = !!(chain && chain.attempts.length > 0);

  return (
    <div className="min-h-full flex flex-col">
      <Header />

      <main className="flex-1 mx-auto w-full max-w-[1320px] px-4 sm:px-6 py-5 sm:py-8">
        {/* The optical bench: a control RAIL (chrome plane) and the WORK surface,
            joined by the light-spectrum spine. The spine is the tool's axis made
            structural — not a decorative stripe. */}
        <div className="grid gap-5 lg:gap-0 lg:grid-cols-[336px_3px_minmax(0,1fr)] items-stretch">
          {/* LEFT: the control rail (sticky on desktop) */}
          <aside className="lg:sticky lg:top-[84px] lg:self-start lg:pr-8">
            <InputPanel
              focusedSlot={focusedSlot}
              setFocusedSlot={setFocusedSlot}
              onToast={showToast}
            />
          </aside>

          {/* the spectrum spine — the seam between chrome and work planes, and the
              tool's axis made structural. Runs the full height of the bench with a
              soft bloom; reads as an intentional light-guide, not a hairline. */}
          <div aria-hidden className="hidden lg:block relative w-[3px]">
            <span className="absolute inset-y-0 left-0 w-full rounded-full spectrum-spine shadow-[0_0_12px_0_oklch(0.86_0.15_85_/_0.5)]" />
          </div>

          {/* RIGHT: the working surface */}
          <section className="min-w-0 flex flex-col gap-4 lg:pl-8">
            <StorageBanner onToast={showToast} />
            <ErrorBanner error={lastError} />

            {/* main state switch */}
            {inFlight && !hasRecipe ? (
              <AnalyzingState />
            ) : state === "empty" ? (
              <EmptyState />
            ) : state === "ready" ? (
              <ReadyState target={session.activeTarget} />
            ) : (
              <>
                {inFlight && (
                  <div className="rounded-[var(--radius-control)] border border-[var(--color-accent-line)] bg-[var(--color-accent-tint)] px-4 py-2.5 flex items-center gap-2.5 animate-fade">
                    <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-[var(--color-accent-strong)] border-t-transparent animate-spin" />
                    <span className="text-[0.82rem] font-medium text-[var(--color-accent-ink)]">
                      Working on the match…
                    </span>
                  </div>
                )}
                <RecipeView onToast={showToast} />
                {hasAttempts && <RefineLedger onToast={showToast} />}
              </>
            )}
          </section>
        </div>
      </main>

      <Toast message={toast} />
    </div>
  );
}
