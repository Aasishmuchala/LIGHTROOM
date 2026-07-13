"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { engineStore, useEngine } from "@/store/useEngine";
import { Header } from "@/components/Header";
import { InputPanel } from "@/components/InputPanel";
import { EmptyState } from "@/components/EmptyState";
import { ReadyState, AnalyzingState } from "@/components/StatusStates";
import { RecipeView } from "@/components/RecipeView";
import { RefineLedger } from "@/components/RefineLedger";
import { ExpertChat } from "@/components/ExpertChat";
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
      // The settings screenshot slot was retired from the UI; paste routes only
      // ref → base → attempt. Marking settings as "filled" keeps routePaste's shared
      // logic byte-identical while never selecting the (now non-rendered) settings slot.
      const filled = {
        ref: !!sess.ref,
        base: !!sess.base,
        settings: true,
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
        } catch (e) {
          // Most failures annotate lastError and raise the ErrorBanner (decode, busy).
          // But a stale 'attempt' focus after a target switch throws a plain Error the
          // store does NOT annotate — without this the paste vanished with zero
          // feedback (stress finding C8). Toast the reason only when no banner will show.
          if (!engineStore.getState().lastError) {
            showToast((e as Error)?.message || "That paste couldn't be placed.");
          }
        }
      })();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [showToast]);

  // Window-level drop guard (stress finding C9): a file dropped a few pixels OUTSIDE a
  // port would otherwise hit the browser default — navigate the tab to the local image
  // file, unloading the app mid-session (unrecoverable in a storage-degraded/incognito
  // session). The ports call stopPropagation on their own drop, so anything reaching the
  // window missed a target; swallow it. dragover must also preventDefault or the drop
  // event never fires as "copy" and some browsers still navigate.
  useEffect(() => {
    const swallow = (ev: DragEvent) => {
      // Only intercept file drags — never interfere with text/other DnD.
      const types = ev.dataTransfer?.types;
      const isFile = types && Array.prototype.indexOf.call(types, "Files") !== -1;
      if (!isFile) return;
      ev.preventDefault();
    };
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  const hasRecipe = !!(chain && chain.recipe);
  const hasAttempts = !!(chain && chain.attempts.length > 0);

  return (
    <div className="min-h-full">
      {/* The instrument: one bakelite faceplate with a chrome edge and corner screws.
          The header is its top plate; the two columns are the input bay + the readout. */}
      <main className="mx-auto w-full max-w-[1180px] px-3 sm:px-6 py-6 sm:py-10">
        <div className="device">
          <span aria-hidden className="screw" style={{ top: 15, left: 15 }} />
          <span aria-hidden className="screw" style={{ top: 15, right: 15 }} />
          <span aria-hidden className="screw" style={{ bottom: 15, left: 15 }} />
          <span aria-hidden className="screw" style={{ bottom: 15, right: 15 }} />

          <Header />

          {/* the bench: input bay (left) + readout (right) */}
          <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)] items-start px-1 sm:px-2 pb-1">
            {/* LEFT: the input bay */}
            <aside>
              <InputPanel
                focusedSlot={focusedSlot}
                setFocusedSlot={setFocusedSlot}
                onToast={showToast}
              />
            </aside>

            {/* RIGHT: the readout */}
            <section className="min-w-0 flex flex-col gap-4">
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
                    <div className="rounded-[var(--radius-control)] bg-[var(--color-accent-tint)] px-4 py-2.5 flex items-center gap-2.5 animate-fade shadow-[inset_0_1px_2px_oklch(0.2_0.01_60_/_0.25),0_0_0_1px_var(--color-accent-line)]">
                      <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-[var(--color-accent-strong)] border-t-transparent animate-spin" />
                      <span className="text-[0.82rem] font-semibold text-[var(--color-accent-ink)]">
                        Reading the light…
                      </span>
                    </div>
                  )}
                  <RecipeView onToast={showToast} />
                  {hasAttempts && <RefineLedger onToast={showToast} />}
                </>
              )}

              {/* The operator line: available once both frames are loaded (a check-in
                  needs a reference to measure against, and there's a session to discuss).
                  Sits below the readout as its own instrument. */}
              {state !== "empty" && !(inFlight && !hasRecipe) && (
                <ExpertChat onToast={showToast} />
              )}
            </section>
          </div>
        </div>
      </main>

      <Toast message={toast} />
    </div>
  );
}
