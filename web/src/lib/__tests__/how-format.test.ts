import { describe, it, expect } from "vitest";
import { formatHelpAnswer, type HelpLine } from "../how-format";

// helper: pull just the step texts / numbers in order
const steps = (ls: HelpLine[]) => ls.filter((l) => l.type === "step") as Extract<HelpLine, { type: "step" }>[];
const notes = (ls: HelpLine[]) => ls.filter((l) => l.type === "note") as Extract<HelpLine, { type: "note" }>[];

describe("formatHelpAnswer — degenerate / non-string input", () => {
  it("empty string -> plain, raw preserved", () => {
    const f = formatHelpAnswer("");
    expect(f.mode).toBe("plain");
    expect(f.raw).toBe("");
    expect(f.lines).toHaveLength(0);
  });
  it("null and undefined -> plain, raw '' (never throws)", () => {
    expect(formatHelpAnswer(null).mode).toBe("plain");
    expect(formatHelpAnswer(null).raw).toBe("");
    expect(formatHelpAnswer(undefined).mode).toBe("plain");
  });
  it("a number/object coerces to string, never throws", () => {
    expect(formatHelpAnswer(42 as unknown).raw).toBe("42");
    expect(() => formatHelpAnswer({} as unknown)).not.toThrow();
  });
  it("whitespace-only -> plain", () => {
    expect(formatHelpAnswer("   \n\n  \t ").mode).toBe("plain");
  });
});

describe("formatHelpAnswer — numbered detection threshold", () => {
  it("a single numbered line is NOT a step list (needs >= 2)", () => {
    const f = formatHelpAnswer("1. do the thing");
    expect(f.mode).toBe("plain");
  });
  it("two numbered lines ARE a step list", () => {
    const f = formatHelpAnswer("1. first\n2. second");
    expect(f.mode).toBe("steps");
    expect(steps(f.lines).map((s) => s.num)).toEqual(["1", "2"]);
    expect(steps(f.lines).map((s) => s.text)).toEqual(["first", "second"]);
  });
  it("one numbered line among 4 lines (<50%) -> plain", () => {
    const f = formatHelpAnswer("intro line\n1. only step\nsome note\nanother note");
    expect(f.mode).toBe("plain");
  });
  it("exactly 50% numbered (2 of 4) -> steps, notes kept in order", () => {
    const f = formatHelpAnswer("1. a\n2. b\nnote one\nnote two");
    expect(f.mode).toBe("steps");
    expect(steps(f.lines)).toHaveLength(2);
    expect(notes(f.lines)).toHaveLength(2);
  });
  it("prose with no numbers -> plain", () => {
    const f = formatHelpAnswer("Just select the sun and change its color temperature to warm.");
    expect(f.mode).toBe("plain");
  });
});

describe("formatHelpAnswer — numbering styles & ordering", () => {
  it("paren style '1)' is recognized", () => {
    const f = formatHelpAnswer("1) open panel\n2) set value");
    expect(f.mode).toBe("steps");
    expect(steps(f.lines).map((s) => s.num)).toEqual(["1", "2"]);
  });
  it("multi-digit numbers preserved faithfully", () => {
    const f = formatHelpAnswer("9. nine\n10. ten\n11. eleven");
    expect(steps(f.lines).map((s) => s.num)).toEqual(["9", "10", "11"]);
  });
  it("a LEADING intro line stays first (source order preserved)", () => {
    const f = formatHelpAnswer("First, select the VRaySun.\n1. open Modify\n2. set turbidity");
    expect(f.mode).toBe("steps");
    expect(f.lines[0]).toEqual({ type: "note", text: "First, select the VRaySun." });
    expect(f.lines[1].type).toBe("step");
  });
  it("a TRAILING note stays last", () => {
    const f = formatHelpAnswer("1. a\n2. b\nReasoning: because.");
    expect(f.lines[f.lines.length - 1]).toEqual({ type: "note", text: "Reasoning: because." });
  });
  it("'1 do x' without a delimiter is NOT a step (avoids matching '1 apple')", () => {
    const f = formatHelpAnswer("1 do x\n2 do y");
    expect(f.mode).toBe("plain");
  });
});

describe("formatHelpAnswer — whitespace / CRLF / fences robustness", () => {
  it("CRLF line endings: no stray \\r in step text", () => {
    const f = formatHelpAnswer("1. alpha\r\n2. beta");
    expect(steps(f.lines).map((s) => s.text)).toEqual(["alpha", "beta"]);
  });
  it("blank-line runs between steps are collapsed", () => {
    const f = formatHelpAnswer("1. a\n\n\n2. b\n\n3. c");
    expect(steps(f.lines)).toHaveLength(3);
  });
  it("a wrapping ``` code fence is stripped, steps still detected", () => {
    const f = formatHelpAnswer("```\n1. first\n2. second\n```");
    expect(f.mode).toBe("steps");
    expect(steps(f.lines).map((s) => s.text)).toEqual(["first", "second"]);
  });
  it("a fenced block with a language tag is stripped", () => {
    const f = formatHelpAnswer("```text\n1. first\n2. second\n```");
    expect(f.mode).toBe("steps");
    expect(steps(f.lines)).toHaveLength(2);
  });
  it("an empty-text numbered line keeps the number with empty text", () => {
    const f = formatHelpAnswer("1.\n2. has text");
    expect(f.mode).toBe("steps");
    expect(steps(f.lines)[0]).toEqual({ type: "step", num: "1", text: "" });
  });
  it("extremely long single step does not throw and is one step", () => {
    const long = "1. " + "x".repeat(5000) + "\n2. short";
    const f = formatHelpAnswer(long);
    expect(f.mode).toBe("steps");
    expect(steps(f.lines)).toHaveLength(2);
    expect(steps(f.lines)[0].text.length).toBe(5000);
  });
});
