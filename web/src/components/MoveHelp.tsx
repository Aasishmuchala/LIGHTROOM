"use client";

// MoveHelp — the per-move "how do I do this?" chat. Renders a quiet engraved toggle
// under a recipe move; opening it slides out a recessed instruction slot that AUTO-ASKS
// the model for exact click-by-click UI steps for THAT one control, then lets the user
// ask follow-ups scoped to it. Each move owns its own conversation (component-local
// state) — nothing is persisted; it's a throwaway "walk me through this knob" panel.

import { useEffect, useRef, useState } from "react";
import { askHow, type HowMsg } from "@/lib/how-client";
import { formatHelpAnswer } from "@/lib/how-format";
import { splitPath, type SheetRow } from "./lib";

export function MoveHelp({ row, target }: { row: SheetRow; target: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<HowMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const started = useRef(false); // fire the auto-answer only once per move
  const scrollRef = useRef<HTMLDivElement>(null);

  const leaf = splitPath(row.ui_path).leaf;
  const unitSuffix = row.unit && typeof row.value === "number" ? " " + row.unit : "";
  const control = {
    name: leaf,
    path: row.ui_path,
    value: row.value,
    from: row.from,
    unit: row.unit,
    kind: row.kind,
    description: row.why, // the move's rationale — useful context for "how"
  };

  // send(text, prior): append the user turn, call the route, append the answer. `prior`
  // is passed explicitly for the initial auto-ask (messages state is still [] then) and
  // for retry (re-send from before the failed turn), sidestepping stale-closure issues.
  async function send(text: string, prior?: HowMsg[]) {
    const base = prior ?? messages;
    const next: HowMsg[] = [...base, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setError("");
    setLoading(true);
    const r = await askHow(target, control, next);
    setLoading(false);
    if (r.ok && r.answer) {
      setMessages([...next, { role: "assistant", content: r.answer }]);
    } else {
      setError(r.error || "No steps came back — try again.");
    }
  }

  function toggle() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && !started.current) {
      started.current = true;
      void send(`How exactly do I set "${leaf}" to ${row.value}${unitSuffix} in the UI? Give the exact steps.`, []);
    }
  }

  function onRetry() {
    // last turn is the user question whose answer failed; re-send from before it.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const prior = messages.slice(0, Math.max(0, messages.length - 1));
    if (lastUser) void send(lastUser.content, prior);
  }

  // keep the transcript pinned to the newest line as it grows / while typing.
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, open]);

  return (
    <div className="mt-2">
      <button
        type="button"
        className={`btn-how ${open ? "is-open" : ""}`}
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="btn-how-ico" aria-hidden>
          ?
        </span>
        {open ? "Hide steps" : "How do I set this?"}
      </button>

      {open && (
        <div className="how-panel animate-rise">
          <div className="how-scroll" ref={scrollRef}>
            {messages.map((m, i) =>
              m.role === "assistant" ? (
                <div key={i} className="how-msg how-msg--bot">
                  <StepText text={m.content} />
                </div>
              ) : (
                <div key={i} className="how-msg how-msg--you">
                  {m.content}
                </div>
              )
            )}
            {loading && (
              <div className="how-msg how-msg--bot how-typing" aria-label="Working out the steps">
                <span />
                <span />
                <span />
              </div>
            )}
            {error && (
              <div className="how-error" role="alert">
                <span>{error}</span>
                <button type="button" className="btn-mini" onClick={onRetry}>
                  Retry
                </button>
              </div>
            )}
          </div>

          <form
            className="how-ask"
            onSubmit={(e) => {
              e.preventDefault();
              const t = input.trim();
              if (t && !loading) void send(t);
            }}
          >
            <input
              className="how-input field"
              placeholder="Ask a follow-up — e.g. “I can’t find that rollout”"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              aria-label={`Ask about ${leaf}`}
            />
            <button className="how-send" type="submit" disabled={loading || !input.trim()}>
              Ask
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// StepText — render an answer via the pure formatHelpAnswer classifier: a numbered list
// becomes ordered amber-disc steps (model's own numbers, source order preserved); free
// prose renders verbatim. See lib/how-format.ts for the classification + its tests.
function StepText({ text }: { text: string }) {
  const fmt = formatHelpAnswer(text);
  if (fmt.mode === "plain") return <div className="how-plain">{fmt.raw}</div>;
  return (
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
  );
}

export default MoveHelp;
