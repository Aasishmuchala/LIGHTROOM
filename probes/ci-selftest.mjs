#!/usr/bin/env node
/* =============================================================================
 * probes/ci-selftest.mjs — headless CI gate for the legacy single-file app.
 *
 * CONTRACT (owned by lightmatch.html): visiting lightmatch.html?selftest runs
 * the in-page assert suite and writes the verdict into document.title —
 * "SELFTEST: PASS (N asserts)" on success, "SELFTEST: FAIL..." otherwise.
 * (probes/run-selftest.ps1 is the local Windows runner for the same contract;
 * this script is its Linux/CI twin.)
 *
 * WHAT THIS DOES:
 *   1. serve the repo root over HTTP (npx http-server, port 8321) — the app
 *      touches fetch/IndexedDB, so file:// is not a faithful environment;
 *   2. open the ?selftest URL in Playwright chromium (headless);
 *   3. poll page.title() until it carries a SELFTEST verdict;
 *   4. exit 0 only on "SELFTEST: PASS", 1 on FAIL / no verdict / any error.
 *
 * DEPS: node >= 18 built-ins (global fetch) + the `playwright` package. The
 * workflow installs playwright with `npm install --no-save` at the repo root,
 * so no package.json / lockfile in the repo is created or modified.
 *
 * Hard wall: the WHOLE run (server boot + browser + verdict) must finish
 * inside DEADLINE_MS or we exit 1. Every exit path is an explicit
 * process.exit(), so the wall timer keeping the event loop alive is harmless.
 * ========================================================================== */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8321;
const PAGE_URL = `http://localhost:${PORT}/lightmatch.html?selftest`;
const DEADLINE_MS = 120_000;
const startedAt = Date.now();
const remaining = () => DEADLINE_MS - (Date.now() - startedAt);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- static server over the repo root --------------------------------------
// win32 needs a shell because npx is npx.cmd there; a single command string
// (not an args array) avoids node's DEP0190 shell-escaping warning — every
// token is a constant, so there is nothing to escape. Linux/CI takes the
// plain argv path. stdio ignored: http-server's request log is noise here.
function startServer() {
  const opts = { cwd: ROOT, stdio: "ignore" };
  return process.platform === "win32"
    ? spawn(`npx --yes http-server -p ${PORT} .`, { ...opts, shell: true })
    : spawn("npx", ["--yes", "http-server", "-p", String(PORT), "."], opts);
}

// Best-effort teardown. On win32 the shell wrapper means child.kill() would
// orphan the actual node process holding the port, so kill the whole tree.
// On CI (ubuntu) the runner reaps everything anyway — this is for local runs.
function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    /* best effort only */
  }
}

async function waitForServer() {
  // Server is "up" when the app page itself serves 200 — proves both the
  // port bind AND that we are serving the right directory.
  while (remaining() > 0) {
    try {
      const res = await fetch(`http://localhost:${PORT}/lightmatch.html`, { method: "GET" });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`http-server did not serve lightmatch.html within the deadline`);
}

// ---- main -------------------------------------------------------------------
const server = startServer();
// Hard wall: fires only if something below hangs past the deadline. Not
// unref'd on purpose — all healthy paths exit explicitly before it matters.
setTimeout(() => {
  console.error(`SELFTEST: NO VERDICT within ${DEADLINE_MS / 1000}s`);
  stopServer(server);
  process.exit(1);
}, DEADLINE_MS);

let browser = null;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: Math.max(remaining(), 1) });

  // Poll the title until the suite posts a verdict (PASS or FAIL both count
  // as "verdict reached"; only PASS is green).
  let title = "";
  while (remaining() > 0) {
    title = await page.title();
    if (title.includes("SELFTEST:")) break;
    await sleep(500);
  }

  const pass = title.includes("SELFTEST: PASS");
  console.log(title ? title : "SELFTEST: NO VERDICT (title never changed)");
  await browser.close();
  stopServer(server);
  process.exit(pass ? 0 : 1);
} catch (err) {
  console.error(`SELFTEST: ERROR — ${err?.message ?? err}`);
  try {
    if (browser) await browser.close();
  } catch {
    /* already gone */
  }
  stopServer(server);
  process.exit(1);
}
