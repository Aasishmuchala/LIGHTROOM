"use client";

// 3ds Max live bridge card — status + "Pull current settings". The pulled values
// land on the session (engine.setLiveSettings) and travel with every analyze as the
// CURRENT SCENE SETTINGS evidence block, so the model's `from` baseline is the real
// scene, not assumed factory defaults. Quiet/secondary by design: the bridge is an
// accelerator, never a requirement — everything works without Max running.

import { useState } from "react";
import { useEngine, engineStore } from "@/store/useEngine";

type BridgeState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "offline"; detail: string }
  | { kind: "online"; renderer: string; maxVersion?: number }
  | { kind: "pulling" }
  | { kind: "error"; detail: string };

export function MaxBridge({ onToast }: { onToast: (m: string) => void }) {
  const live = useEngine((s) => s.session.liveSettings ?? null);
  const [state, setState] = useState<BridgeState>({ kind: "idle" });

  const ping = async (): Promise<boolean> => {
    setState({ kind: "checking" });
    try {
      const res = await fetch("/api/max", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "ping" }),
      });
      const body = await res.json();
      if (body.ok) {
        setState({
          kind: "online",
          renderer: String(body.info?.renderer ?? "unknown"),
          maxVersion: typeof body.info?.maxVersion === "number" ? body.info.maxVersion : undefined,
        });
        return true;
      }
      setState({ kind: "offline", detail: String(body.error || "not reachable") });
      return false;
    } catch (e) {
      setState({ kind: "offline", detail: (e as Error)?.message || "not reachable" });
      return false;
    }
  };

  const pull = async () => {
    if (!(await ping())) return;
    setState({ kind: "pulling" });
    try {
      const res = await fetch("/api/max", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "pull" }),
      });
      const body = await res.json();
      if (!body.ok || !body.pulled) {
        setState({ kind: "error", detail: String(body.error || "pull failed") });
        return;
      }
      const pulled = body.pulled;
      await engineStore.getState().setLiveSettings({
        renderer: pulled.renderer,
        at: new Date().toISOString(),
        counts: pulled.counts,
        params: pulled.params,
      });
      setState({ kind: "online", renderer: pulled.renderer });
      onToast(
        `Pulled ${Object.keys(pulled.params).length} live values from 3ds Max` +
          (pulled.vray ? "" : " — note: current renderer is not V-Ray")
      );
    } catch (e) {
      setState({ kind: "error", detail: (e as Error)?.message || "pull failed" });
    }
  };

  const dot =
    state.kind === "online"
      ? "var(--color-good)"
      : state.kind === "offline" || state.kind === "error"
        ? "var(--color-danger)"
        : "var(--color-faint)";
  const busy = state.kind === "checking" || state.kind === "pulling";
  const pulledCount = live ? Object.keys(live.params || {}).length : 0;

  return (
    <div
      className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 flex flex-col gap-1.5"
      data-max-bridge
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[0.72rem] font-[620] uppercase tracking-[0.06em] text-[var(--color-muted)]">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: dot }}
            aria-hidden
          />
          3ds Max bridge
        </span>
        <button
          type="button"
          onClick={pull}
          disabled={busy}
          className="text-[0.74rem] font-[600] rounded-full border border-[var(--color-line)] px-2.5 py-0.5 text-[var(--color-ink-2)] hover:text-[var(--color-ink)] hover:border-[var(--color-accent-line)] disabled:opacity-50 transition-colors"
        >
          {state.kind === "pulling" ? "Pulling…" : state.kind === "checking" ? "Checking…" : "Pull current settings"}
        </button>
      </div>
      <p className="text-[0.7rem] leading-snug text-[var(--color-faint)]">
        {state.kind === "online" && `Connected — ${state.renderer}${state.maxVersion ? ` · Max ${state.maxVersion}` : ""}.`}
        {state.kind === "offline" && "3ds Max not reachable — start Max (MCP listener installed) and retry."}
        {state.kind === "error" && `Bridge error: ${state.detail}`}
        {(state.kind === "idle" || busy) &&
          (pulledCount
            ? null
            : "Reads the scene's real V-Ray values so the recipe starts from truth, not defaults.")}
        {pulledCount > 0 && (
          <span className="text-[var(--color-ink-2)]">
            {" "}
            {pulledCount} live values on this session ({live!.renderer}) — recipes use them as the true baseline.
          </span>
        )}
      </p>
    </div>
  );
}
