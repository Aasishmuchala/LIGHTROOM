# Precondition probe results — 2026-07-02

## 0.1 CORS preflight (omega gateway) — ✅ PASS

`OPTIONS https://omega.kesarcloud.in/v1/messages` with `Origin: null`:

```
STATUS: 204
Access-Control-Allow-Origin: null
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS
Access-Control-Allow-Headers: authorization, content-type            (request 1)
Access-Control-Allow-Headers: authorization, content-type, anthropic-version  (request 2)
Vary: Origin
```

- `Access-Control-Allow-Origin: null` is exactly what a page opened from disk sends (`Origin: null`) → **direct `fetch` from `file://` works**.
- The allow-headers list is **reflective** (echoes whatever is requested) → the adapter may send `anthropic-version` safely.
- Gateway fronted by Cloudflare (`X-Omniroute-Route-Class: CLIENT_API`).

## 0.2 `oc_` key location — deferred to paste-at-runtime

Not in environment variables (`OMEGA|KESAR|OC_|OPUS` patterns) and not on disk in `DavinciPlugin` (grep `oc_[A-Za-z0-9]{8}` → no hits; hermes hits were unrelated code). The app's design already takes a pasted key stored in `localStorage`; steps 0.3 (model IDs) and 0.4 (vision/tool probe per model) run at first live smoke (plan Task 8) when the user pastes the key.

## 0.3 Model IDs — DEFERRED (needs key)

Expected per memory: `claude-opus-4-8` + a GPT-5.5 id. Verify via `GET /v1/models` with Bearer key before hardcoding picker options.

## 0.4 Vision + forced-tool probe — DEFERRED (needs key)

Must pass for both models before the picker ships both; GPT-5.5 failure → Opus-only picker (spec risk table).

## 0.5 IndexedDB on `file://` — ✅ PASS (with cross-launch persistence)

Real Chrome (separate `--user-data-dir`), verdict read from window title:

```
RUN1: IDB OK prev=none
RUN2: IDB OK prev=2026-07-02T15:22:43.571Z   <- read run 1's write after full browser exit
```

No export/import fallback needed on this machine's Chrome.

## Test-runner finding (affects the whole plan)

`chrome --headless=new --virtual-time-budget=N --dump-dom` **starves real async I/O**: virtual time burns through timer-based timeouts before IndexedDB (and other real-async) callbacks fire. Verdict lines from async suites never render.

**Canonical runner is therefore the window-title pattern** (`SELFTEST` writes its verdict to `document.title`; PowerShell launches real Chrome with an own profile, polls `MainWindowTitle`, then kills that profile's processes). See `probes/run-selftest.ps1`. `--dump-dom` remains acceptable only for fully synchronous suites.
