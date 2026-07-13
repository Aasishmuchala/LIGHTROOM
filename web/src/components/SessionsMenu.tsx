"use client";

// SessionsMenu — the session switcher. Area mode's workflow is ONE SESSION PER AREA
// on a big project, which is only usable if you can actually get back to a session:
// this lists every stored session (newest-used first) with its reference thumbnail,
// name, target, and best match so far — open any, rename inline, delete, or start a
// fresh one. Same fixed-position popover mechanics as SetupMenu (never clipped,
// outside-click/Esc to close). The list is (re)fetched on every open — sessions
// change constantly and the summaries are cheap.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { engineStore, useEngine, SESSION_RETENTION_CAP } from "@/store/useEngine";
import { STORE, type SessionSummary } from "@/lib/store";
import { matchPercent, MATCH_THRESHOLD } from "@/lib/metrics";

function targetChip(t: string): string {
  return t === "vantage33" ? "Vantage" : "V-Ray";
}

export function SessionsMenu({ onFlash }: { onFlash: (m: string) => void }) {
  const liveId = useEngine((s) => s.session.id);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [list, setList] = useState<SessionSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      setList(await STORE.listSessions());
    } catch {
      setList([]);
    }
  };

  useEffect(() => {
    if (open) void refresh();
    // reset transient row states whenever the panel opens/closes
    setRenaming(null);
    setConfirmDelete(null);
  }, [open]);

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

  // focus the rename field as it appears
  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  const onOpenSession = async (id: string) => {
    if (busy || id === liveId) return;
    setBusy(true);
    try {
      await engineStore.getState().openSession(id);
      onFlash("Session opened.");
      setOpen(false);
    } catch (e) {
      onFlash((e as Error)?.message || "Couldn't open that session.");
    } finally {
      setBusy(false);
    }
  };

  const onNew = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await engineStore.getState().newSession();
      onFlash("Fresh session.");
      setOpen(false);
    } catch (e) {
      onFlash((e as Error)?.message || "Couldn't start a new session.");
    } finally {
      setBusy(false);
    }
  };

  const onRenameCommit = async (id: string) => {
    const v = renameRef.current?.value ?? "";
    setRenaming(null);
    await engineStore.getState().renameSession(id, v);
    await refresh();
  };

  const onDelete = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await engineStore.getState().deleteSession(id);
      setConfirmDelete(null);
      await refresh();
      onFlash("Session deleted.");
    } catch (e) {
      onFlash((e as Error)?.message || "Couldn't delete that session.");
    } finally {
      setBusy(false);
    }
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
        title="Sessions — one per shot/area; open, rename, or start fresh"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
          <rect x="2" y="2" width="9" height="9" rx="1.5" />
          <path d="M5 14h8a1.5 1.5 0 0 0 1.5-1.5V5" strokeLinecap="round" />
        </svg>
        <span className="setup-trigger-label">Sessions</span>
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Sessions"
          className="setup-panel sessions-panel animate-rise"
          style={{ top: pos.top, right: pos.right }}
        >
          <div className="sessions-head">
            <span className="setup-label">Sessions</span>
            <button className="btn-mini" onClick={onNew} disabled={busy}>
              + New session
            </button>
          </div>
          <p className="setup-note !max-w-none px-[0.55rem]">
            One per shot or area. Opening a session brings back its frames, recipe, attempts, and chat.
          </p>

          <div className="sessions-list" role="list">
            {list.length === 0 && (
              <p className="setup-note px-[0.55rem] py-2">Nothing stored yet.</p>
            )}
            {list.map((s) => {
              const isLive = s.id === liveId;
              const pct = s.bestScore !== null ? matchPercent(s.bestScore) : null;
              const matched = s.bestScore !== null && s.bestScore <= MATCH_THRESHOLD;
              const label = s.name || `Session · ${new Date(s.created).toLocaleDateString()}`;
              return (
                <div key={s.id} role="listitem" className={`session-row ${isLive ? "is-live" : ""}`}>
                  <button
                    type="button"
                    className="session-open"
                    onClick={() => onOpenSession(s.id)}
                    disabled={busy || isLive}
                    title={isLive ? "This is the open session" : "Open this session"}
                  >
                    {s.refThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.refThumb} alt="" className="session-thumb" />
                    ) : (
                      <span className="session-thumb session-thumb--empty" aria-hidden />
                    )}
                    <span className="session-meta">
                      {renaming === s.id ? (
                        <input
                          ref={renameRef}
                          className="field session-rename"
                          defaultValue={s.name}
                          maxLength={60}
                          placeholder="Name this area…"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void onRenameCommit(s.id);
                            }
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          onBlur={() => void onRenameCommit(s.id)}
                        />
                      ) : (
                        <span className="session-name">
                          {label}
                          {isLive && <span className="session-live-tag">open</span>}
                          {s.lockGlobals && (
                            <span className="session-lock-tag" title="Area mode — globals locked">
                              locked
                            </span>
                          )}
                        </span>
                      )}
                      <span className="session-sub">
                        {targetChip(s.activeTarget)}
                        {s.hasRecipe ? " · recipe" : ""}
                        {s.attempts > 0 ? ` · ${s.attempts} attempt${s.attempts === 1 ? "" : "s"}` : ""}
                        {pct !== null && (
                          <span className={matched ? "session-pct session-pct--matched" : "session-pct"}>
                            {" "}
                            · {pct}%
                          </span>
                        )}
                      </span>
                    </span>
                  </button>

                  <span className="session-actions">
                    <button
                      type="button"
                      className="btn-mini"
                      onClick={() => setRenaming(renaming === s.id ? null : s.id)}
                      title="Rename"
                    >
                      ✎
                    </button>
                    {confirmDelete === s.id ? (
                      <button
                        type="button"
                        className="btn-mini session-del-confirm"
                        onClick={() => onDelete(s.id)}
                        disabled={busy}
                        title="Really delete — this cannot be undone"
                      >
                        sure?
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-mini"
                        onClick={() => setConfirmDelete(s.id)}
                        title="Delete session"
                      >
                        ✕
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="setup-foot">
            The newest {SESSION_RETENTION_CAP} sessions are kept; export anything you want to archive.
          </p>
        </div>
      )}
    </>
  );
}

export default SessionsMenu;
