"use client";

// ExpertChat — the "operator line". A session-aware lighting TD who knows V-Ray 7 and
// Chaos Vantage 3.3 in the app's exact-control vocabulary. Two things happen here:
//   - the user asks anything about lighting / the recipe / the renderer, and the model
//     answers with full awareness of the live session (a digest rides on every send);
//   - the user DROPS A NEW RENDER (after applying the recipe) and the panel measures it
//     with the same deterministic photometry the refine loop trusts, shows the match
//     read-out, and the model confirms the match or issues the shortest re-edit list.
//
// The transcript lives in the engine (session.chat), so it persists with the session
// and survives reload — a check-in you made yesterday is still here, scored. This
// component owns only the ephemeral send state (input text, in-flight, inline error)
// and the handle to the just-measured render so it can be logged as a formal attempt.
//
// It never touches the global analyze in-flight gate: chatCheckin measures locally and
// makes NO model call, so you can talk to the operator while an analyze runs.

import { useEffect, useRef, useState } from "react";
import { engineStore, useEngine, type ChatMsg } from "@/store/useEngine";
import { askExpert, type ExpertMsg } from "@/lib/chat-client";
import { sessionDigest } from "@/lib/chat-digest";
import { formatHelpAnswer } from "@/lib/how-format";
import { acceptsFile, safeSrc } from "./lib";
import type { TargetId } from "@/lib/types";
import { PACKS } from "@/lib/packs";
import { MATCH_THRESHOLD, matchPercent } from "@/lib/metrics";

// -- map the stored transcript to the wire shape: a check-in turn folds its measured
// evidence text into the content (so the model reads the numbers) and carries its
// developed render as the image. Pure. ----------------------------------------------
function toExpertMessages(msgs: ChatMsg[]): ExpertMsg[] {
  return msgs.map((m) => {
    if (m.checkin) {
      return {
        role: m.role,
        content: `${m.content}\n\n${m.checkin.evidenceText}`,
        imageDataUrl: m.checkin.dataUrl,
      };
    }
    return { role: m.role, content: m.content };
  });
}

// Stable empty transcript — returning a fresh [] from a selector each render trips
// useSyncExternalStore's snapshot check; deriving from the already-selected session
// with a module constant fallback keeps the reference stable when chat is null.
const EMPTY_MESSAGES: ChatMsg[] = [];

export function ExpertChat({ onToast }: { onToast: (m: string) => void }) {
  const session = useEngine((s) => s.session);
  const messages = session.chat?.messages ?? EMPTY_MESSAGES;
  const target = session.activeTarget as TargetId;
  const hasRef = !!session.ref;
  const hasRecipe = !!session.chains[target]?.recipe;

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // The most recent fresh check-in (dataUrl+metrics live only in memory) so it can be
  // promoted to a formal attempt. Cleared once logged, or when its message scrolls out.
  const [lastCheckin, setLastCheckin] = useState<{
    preCaptured: { dataUrl: string; metrics: unknown };
    at: string;
  } | null>(null);
  const [logging, setLogging] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const targetLabel =
    (PACKS as unknown as Record<string, { label?: string } | undefined>)[target]?.label ||
    (target === "vantage33" ? "Chaos Vantage 3.3" : "V-Ray 7");

  // keep the transcript pinned to the newest line as it grows / while typing.
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, open]);

  const empty = messages.length === 0;

  // -- ask(): the model round. Reads the CURRENT session for a fresh digest each time
  // (the session moves under the chat — new recipe, new attempt), sends the mapped
  // transcript, appends the answer. The user turn is already in the transcript before
  // this runs, so a failure leaves it in place and Retry re-sends. --------------------
  const ask = async () => {
    setLoading(true);
    setError("");
    const s = engineStore.getState().session;
    const digest = sessionDigest(s);
    const wire = toExpertMessages(engineStore.getState().session.chat?.messages ?? []);
    const r = await askExpert(target, digest, wire);
    setLoading(false);
    if (r.ok && r.answer) {
      await engineStore.getState().chatAppend({ role: "assistant", content: r.answer });
    } else {
      setError(r.error || "No answer came back — try again.");
    }
  };

  const onSendText = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    await engineStore.getState().chatAppend({ role: "user", content: text });
    await ask();
  };

  // -- onCheckin(file): measure the dropped render, append the check-in user turn, then
  // auto-ask the operator to judge it. Errors (bad image, no reference) render inline. --
  const onCheckin = async (file: File) => {
    if (loading) return;
    const check = acceptsFile(file);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setError("");
    setLoading(true);
    let res;
    try {
      res = await engineStore.getState().chatCheckin(file);
    } catch (e) {
      setLoading(false);
      setError((e as Error)?.message || "Could not read that render.");
      return;
    }
    setLastCheckin({ preCaptured: res.preCaptured, at: res.message.at });
    // hand off to the model — reuse ask()'s digest+send (loading already true).
    const s = engineStore.getState().session;
    const digest = sessionDigest(s);
    const wire = toExpertMessages(s.chat?.messages ?? []);
    const r = await askExpert(target, digest, wire);
    setLoading(false);
    if (r.ok && r.answer) {
      await engineStore.getState().chatAppend({ role: "assistant", content: r.answer });
    } else {
      setError(r.error || "Measured the render, but the operator didn't reply — Retry.");
    }
  };

  const onRetry = () => {
    if (loading) return;
    // the last turn is a user message whose answer failed; just re-ask.
    void ask();
  };

  const onLogAttempt = async () => {
    if (!lastCheckin || logging) return;
    setLogging(true);
    try {
      const { score } = await engineStore
        .getState()
        .addAttempt(lastCheckin.preCaptured as { dataUrl: string; metrics: never });
      onToast(`Logged as attempt. Look distance ${Math.round(score)}.`);
      setLastCheckin(null);
    } catch (e) {
      onToast((e as Error)?.message || "Couldn't log that as an attempt.");
    } finally {
      setLogging(false);
    }
  };

  const onClear = async () => {
    await engineStore.getState().chatClear();
    setLastCheckin(null);
    setError("");
    onToast("Operator line cleared.");
  };

  const lastCheckinAt = lastCheckin?.at;

  return (
    <section className="op-panel" aria-label="Operator line — V-Ray / Vantage expert">
      <button
        type="button"
        className={`op-head ${open ? "is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="op-body"
      >
        <span className="op-head-badge" aria-hidden>
          <span className="op-head-lamp" />
        </span>
        <span className="op-head-titles">
          <span className="op-head-title">Operator line</span>
          <span className="op-head-sub">
            Ask the {targetLabel} expert · drop a render to check the match
          </span>
        </span>
        {messages.length > 0 && (
          <span className="op-head-count" aria-hidden>
            {messages.length}
          </span>
        )}
        <span className="op-head-caret caret" aria-hidden>
          ▸
        </span>
      </button>

      {open && (
        <div id="op-body" className="op-body animate-fade">
          <div
            className="op-scroll"
            ref={scrollRef}
            role="log"
            aria-live="polite"
            aria-atomic="false"
          >
            {empty && !loading && (
              <div className="op-teach">
                <p className="op-teach-lead">
                  This is your line to a {targetLabel} lighting TD who can see this session.
                </p>
                <ul className="op-teach-list">
                  <li>
                    Ask anything — “why is my sun blowing out?”, “how do I add fog?”, “explain move 3”.
                  </li>
                  <li>
                    Applied the recipe and re-rendered? <strong>Drop the new render below</strong> — it
                    gets measured against your reference and the operator confirms the match or gives the
                    next re-edits.
                  </li>
                </ul>
              </div>
            )}

            {messages.map((m, i) => (
              <ChatBubble key={i} msg={m} />
            ))}

            {/* log-as-attempt affordance under the freshest check-in, when a recipe exists */}
            {lastCheckinAt &&
              hasRecipe &&
              messages.length > 0 &&
              messages[messages.length - 1]?.role !== "user" && (
                <div className="op-log-row">
                  <button
                    type="button"
                    className="op-log-btn"
                    onClick={onLogAttempt}
                    disabled={logging}
                  >
                    {logging ? "Logging…" : "Log this render as a refine attempt →"}
                  </button>
                  <span className="op-log-hint">files it in the formal refine ledger with a correction card</span>
                </div>
              )}

            {loading && (
              <div className="how-msg how-msg--bot how-typing" aria-label="Operator is thinking">
                <span />
                <span />
                <span />
              </div>
            )}

            {error && (
              <div className="how-error" role="alert">
                <span>{error}</span>
                <button type="button" className="btn-mini" onClick={onRetry} disabled={loading}>
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* composer: attach-render stud + text line + ASK stud */}
          <form
            className="op-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void onSendText();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void onCheckin(f);
            }}
          >
            <button
              type="button"
              className={`op-attach ${dragOver ? "is-drop" : ""}`}
              onClick={() => fileRef.current?.click()}
              disabled={loading || !hasRef}
              title={
                hasRef
                  ? "Drop or pick your latest render to check the match"
                  : "Load a reference first — a check-in is measured against it"
              }
              aria-label="Check a render against the reference"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="2" y="3" width="12" height="10" rx="1.5" />
                <path d="M2 10.5l3-2.5 2.5 2 3-3L14 10" />
                <circle cx="6" cy="6" r="1" />
              </svg>
              <span className="op-attach-label">Check render</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,.exr,image/x-exr"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onCheckin(f);
                e.target.value = "";
              }}
            />
            <input
              className="op-input field"
              placeholder={dragOver ? "Drop the render to check it…" : "Ask the operator…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              aria-label="Ask the operator a question"
            />
            <button className="op-send" type="submit" disabled={loading || !input.trim()}>
              Ask
            </button>
          </form>

          {messages.length > 0 && (
            <div className="op-foot">
              <button type="button" className="btn-mini" onClick={onClear}>
                Clear line
              </button>
              <span className="op-foot-note">Saved with this session · stays on this machine.</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// -- one transcript row. A check-in user turn leads with the developed thumbnail + a lit
// match read-out; the assistant turn renders the operator's numbered re-edits as engraved
// steps (reusing the /api/how formatter) or verbatim prose. --------------------------
function ChatBubble({ msg }: { msg: ChatMsg }) {
  if (msg.role === "user") {
    return (
      <div className="how-msg how-msg--you op-msg--you">
        {msg.checkin && <CheckinCard checkin={msg.checkin} />}
        <span className="op-you-text">{msg.content}</span>
      </div>
    );
  }
  const fmt = formatHelpAnswer(msg.content);
  return (
    <div className="how-msg how-msg--bot op-msg--bot">
      {fmt.mode === "plain" ? (
        <div className="how-plain">{fmt.raw}</div>
      ) : (
        <div className="how-instr">
          {fmt.lines.map((l, i) =>
            l.type === "step" ? (
              <div key={i} className="how-step">
                <span className="how-step-n">{l.num}</span>
                <span>{l.text}</span>
              </div>
            ) : (
              <p key={i} className="how-note">
                {l.text}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}

function CheckinCard({
  checkin,
}: {
  checkin: NonNullable<ChatMsg["checkin"]>;
}) {
  // Mirror the engine's gate exactly: matched ⇔ look distance ≤ MATCH_THRESHOLD,
  // i.e. matchPercent ≥ matchPercent(MATCH_THRESHOLD). No drift from a hardcoded number.
  const matched = checkin.matchPercent >= matchPercent(MATCH_THRESHOLD);
  const src = safeSrc(checkin.dataUrl);
  return (
    <div className="op-checkin">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="Render checked against the reference" className="op-checkin-thumb" />
      )}
      <div className="op-checkin-read">
        <span className={`lamp ${matched ? "lamp-green" : ""}`} aria-hidden />
        <span className="op-checkin-pct tabular-nums">{Math.round(checkin.matchPercent)}%</span>
        <span className="op-checkin-look tabular-nums">look {Math.round(checkin.score)}</span>
      </div>
    </div>
  );
}

export default ExpertChat;
