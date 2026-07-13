"use client";

// RefineDock — the refine loop, co-located. Before this, the artist dropped a
// re-render in the LEFT rail (step 4) but read its score in the RIGHT column: the
// input and its result were a full page-width apart. Here the attempt port and the
// scored correction ledger live in one place, in reading order: drop the re-render →
// read the look-distance + the next moves. The port is the primary action of the loop,
// so it leads. Attempt ingest is the same engine call the rail used to make.

import { engineStore, useEngine } from "@/store/useEngine";
import { DropSlot } from "./DropSlot";
import { RefineLedger } from "./RefineLedger";
import { acceptsFile } from "./lib";

export function RefineDock({
  focusedSlot,
  setFocusedSlot,
  onToast,
}: {
  focusedSlot: string | null;
  setFocusedSlot: (s: string | null) => void;
  onToast: (m: string) => void;
}) {
  const chain = useEngine((s) => s.activeChain());
  const hasAttempts = !!(chain && chain.attempts.length > 0);
  // Attempt numbering, derived from the stable-ref chain (never call attemptInfo() in a
  // selector — it returns a fresh object each render and loops useSyncExternalStore).
  const n = chain
    ? typeof chain._attemptCount === "number"
      ? chain._attemptCount
      : chain.attempts.length
    : 0;

  const ingest = async (file: File) => {
    const check = acceptsFile(file);
    if (!check.ok) {
      onToast(check.reason);
      return;
    }
    try {
      const { score } = await engineStore.getState().addAttempt(file);
      onToast(`Attempt scored. Look distance ${Math.round(score)}.`);
      setFocusedSlot(null);
    } catch {
      /* the store records lastError; the banner shows it */
    }
  };

  return (
    <section className="refine-dock" aria-label="Refine">
      <div className="refine-dock-head">
        <span className="refine-dock-title">Refine</span>
        <span className="refine-dock-sub">
          Apply the recipe, re-render, drop the result back in.
        </span>
      </div>

      <DropSlot
        slotKey="attempt"
        label={`Attempt ${n + 1}`}
        hint={n > 0 ? `${n} logged` : "first re-render"}
        focused={focusedSlot === "attempt"}
        onFocus={() => setFocusedSlot("attempt")}
        onFile={ingest}
        captionOverride={`Drop the re-render — becomes attempt ${n + 1}`}
      />
      <p className="text-[0.72rem] text-[var(--color-muted)] mt-2 pl-0.5">
        Same VFB display settings every attempt.
      </p>

      {hasAttempts && (
        <div className="mt-4">
          <RefineLedger onToast={onToast} />
        </div>
      )}
    </section>
  );
}

export default RefineDock;
