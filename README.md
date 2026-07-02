# LightMatch

LightMatch reads a reference image and a base V-Ray render and emits a lighting recipe in exact V-Ray 7 (3ds Max) / Chaos Vantage 3.3 vocabulary — verbatim UI paths, units, legal ranges, no paraphrase. Analyze once, re-render, drop the attempt back in, and it returns a small prioritized correction card plus a computed convergence score, repeating until the lighting is within noise of the reference (at which point it says so and hands off to color grading).

Recipes are produced by an AI model call through the user's own [omega gateway](https://omega.kesarcloud.in); everything else — image measurement, session state, parameter names — runs locally in the browser.

## How to open

`lightmatch.html` is a single, self-contained file: no server, no build step, no dependencies. Open it directly from disk:

```
file:///C:/Users/aasis/lightmatch/lightmatch.html
```

Double-clicking the file, or dragging it into a browser tab, works too.

## `?selftest`

Appending `?selftest` to the URL runs the in-page test harness instead of booting the UI, and writes its verdict to `document.body` and `document.title` (e.g. `SELFTEST: PASS (N asserts)` or `SELFTEST: FAIL` with one failing assert per line):

```
file:///C:/Users/aasis/lightmatch/lightmatch.html?selftest
```

The canonical way to run it from a script is `probes/run-selftest.ps1`, which launches a real (non-headless) Chrome profile, polls the window title for the verdict, and exits 0/1:

```powershell
powershell -File probes\run-selftest.ps1
```

(Headless `--dump-dom` is not used here — virtual time starves real async I/O such as IndexedDB callbacks; see `probes/results.md`.)

## Key handling

Your API key is pasted into the app once and stored in the browser's `localStorage`; it is sent only as a Bearer token to the omega gateway on each analyze/refine call and is never written anywhere else. Images stay in the browser except inside that same model call.

## Spec

Full design spec: [`docs/superpowers/specs/2026-07-02-lightmatch-design.md`](docs/superpowers/specs/2026-07-02-lightmatch-design.md). Implementation plan: [`docs/superpowers/plans/2026-07-02-lightmatch.md`](docs/superpowers/plans/2026-07-02-lightmatch.md).
