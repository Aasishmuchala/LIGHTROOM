// Pure formatter for a /api/how answer. The model returns plain text; when it's a clean
// numbered list we render each line IN SOURCE ORDER with the model's OWN step number in
// an engraved amber disc (a leading intro line stays on top, trailing notes at the
// bottom). Otherwise we preserve the text verbatim. Extracted from MoveHelp so the
// classification is unit-testable against the real formatting variety different models
// produce (Opus = clean "1./2.", GPT-5.5 sometimes leads with a "Reason:" line, etc.).

export type HelpLine =
  | { type: "step"; num: string; text: string }
  | { type: "note"; text: string };

export interface HelpFormat {
  /** "steps" when the answer is a numbered list; "plain" for free prose. */
  mode: "steps" | "plain";
  /** ordered lines when mode === "steps"; empty for "plain". */
  lines: HelpLine[];
  /** the original answer (used verbatim for "plain" rendering). */
  raw: string;
}

const NUMBERED = /^(\d+)[.)]\s*(.*)$/; // "1. text" or "12) text"

// formatHelpAnswer(input): classify an answer into ordered step/note lines or plain prose.
// Robust to null/undefined/non-string, CRLF, blank-line runs, and a wrapping ``` fence
// the model may add despite instructions. A list is treated as steps only when at least
// two lines are numbered AND numbered lines are at least half of all lines — so a single
// "1." inside prose, or one stray "2)" reference, does not hijack the layout.
export function formatHelpAnswer(input: unknown): HelpFormat {
  const raw = typeof input === "string" ? input : input == null ? "" : String(input);

  // strip a wrapping code fence if present (```lang ... ```), which the model is told not
  // to use but occasionally does; keeps the numbered lines detectable.
  let body = raw.trim();
  if (body.startsWith("```")) {
    body = body.replace(/^```[^\n]*\r?\n?/, "").replace(/\r?\n?```$/, "");
  }

  const lines = body
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const numberedCount = lines.filter((l) => /^\d+[.)]/.test(l)).length;
  const isStepList = numberedCount >= 2 && numberedCount >= Math.ceil(lines.length * 0.5);
  if (!isStepList) return { mode: "plain", lines: [], raw };

  const out: HelpLine[] = lines.map((l) => {
    const m = l.match(NUMBERED);
    return m
      ? { type: "step" as const, num: m[1], text: m[2] }
      : { type: "note" as const, text: l };
  });
  return { mode: "steps", lines: out, raw };
}

export default formatHelpAnswer;
