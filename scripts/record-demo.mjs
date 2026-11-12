#!/usr/bin/env node
/**
 * Records and edits the AppShelf demo video: a real recording of the running
 * app (landing page, templates, sign-up, Stripe test checkout, provisioning,
 * cancel and renew), cut to ~65 s with a voice-over and a music bed.
 *
 * Usage (with the stack running, e.g. `scripts/appshelf.ps1 up`):
 *
 *   npm i --no-save playwright-core@1.56.1
 *   npx playwright-core install ffmpeg
 *   docker run -d --name kokoro-tts -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:v0.2.4
 *   node scripts/record-demo.mjs [outDir]
 *
 * 1. Record. Google Chrome (channel "chrome") at 1280x720 (the screencast is
 *    CSS-pixel sized whatever the scale factor). Every frame carries a small
 *    timecode strip, so the edit can line frames up with the script's events
 *    exactly although Playwright's video clock drifts. A visible cursor moves on eased, curved
 *    paths and ripples on every press; a yellow wipe names the destination
 *    when the flow moves between the app, Stripe and WordPress. The flow is
 *    split into beats, one narration line each, and logs which stretches are
 *    dead time (typing, page loads, waiting for the worker) and which boxes to
 *    zoom into, spotlight or label.
 * 2. Edit. Each beat keeps its live moments at 1x and fast-forwards its dead
 *    time so the beat lasts about its target length (jump cuts above 14x).
 *    ffmpeg re-times the recording in one pass, crops the strip off and scales
 *    it to 1920x1080 (`body.mp4`); the HyperFrames composition in
 *    showcase/media/edit adds the camera moves, spotlight, callouts, subtitles,
 *    speed badges, the provisioning timer and the 2 s / 3 s title and end cards.
 * 3. Sound. Narration from Kokoro TTS (Apache-2.0, local, cached between runs)
 *    and an original music bed from showcase/media/music/generate-bed.py
 *    (CC0), ducked under the voice.
 *
 * Output in outDir (default `<os tmpdir>/appshelf-demo`, outside the repo):
 * `appshelf-demo.mp4` (1280x720 H.264 + AAC, faststart), `appshelf-demo.vtt`,
 * `edit.json`, `timings.json` and the raw `recording.webm`. ffmpeg runs in
 * Docker (linuxserver/ffmpeg).
 *
 * Environment: APP_URL (default http://app.appshelf.localhost), TTS_URL
 * (default http://localhost:8880), TTS_VOICE (default af_heart). Each run signs
 * up a fresh throwaway user; its site deletes itself after 48 hours.
 */
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const APP = (process.env.APP_URL ?? "http://app.appshelf.localhost").replace(/\/$/, "");
const TTS_URL = (process.env.TTS_URL ?? "http://localhost:8880").replace(/\/$/, "");
const VOICE = process.env.TTS_VOICE ?? "af_heart";
const SPEED = 1.12;
let OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "appshelf-demo"));
const EDIT_DIR = path.resolve("showcase/media/edit");
const MUSIC = path.resolve("showcase/media/music/generate-bed.py");
const TTS_CACHE = path.join(os.tmpdir(), "appshelf-demo-tts");
const VIEW = { width: 1280, height: 720 };
// Each recorded frame carries a timecode strip in its bottom TC_H px; the cut
// crops it off (CROP keeps the 16:9 shape) and scales the rest to 1920x1080.
const TC_H = 8, TC_BITS = 24, TC_X = 16, TC_W = 48;
const CROP = { x: 7, w: VIEW.width - 14, h: VIEW.height - TC_H };
const EDIT_W = 1920, EDIT_H = 1080;
const TITLE = 2;
const END = 3;
const HOLD = 1.4; // shortest zoom or spotlight hold in the edit, seconds
const MAX_SPEED = 14;

// One short line per beat; `target` is the beat's length in the edit (seconds).
const BEATS = {
  intro: { line: "AppShelf sells hosted WordPress sites, billed with Stripe.", target: 5.0 },
  templates: { line: "Pick one of three templates.", target: 3.6 },
  signup: { line: "Sign up in seconds. There's no email check in this demo.", target: 4.2 },
  newSite: { line: "Choose a template, name the site, and pick its address.", target: 4.6 },
  pay: { line: "Then pay on Stripe Checkout with the test card.", target: 5.8 },
  // One beat for the whole wait, so "live" always lands on the status flip.
  build: { line: "Stripe sends a webhook, and a worker builds the WordPress site.", target: 4.6 },
  live: { line: "And it's live.", target: 2.6 },
  site: { line: "Here's the new restaurant site, ready to edit.", target: 5.2 },
  cancel: { line: "Cancel the plan, and the licence turns inactive.", target: 4.6 },
  archived: { line: "Visitors now see an archived site.", target: 3.0 },
  renew: { line: "Renew with the same test card.", target: 4.4 },
  back: { line: "Seconds later, it's back online.", target: 3.4 },
  same: { line: "Same site, same content.", target: 3.8 },
};
const END_LINE = "Built with Next.js, Postgres, Stripe and WordPress.";

const run = Date.now().toString(36);
const email = `demo-${run}@example.com`;
const siteTitle = "Luna Bistro";
const slug = `luna-bistro-${run}`;
const timings = {};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- narration (Kokoro TTS) ----------

function wavSeconds(buf) {
  const byteRate = buf.readUInt32LE(28);
  let i = 12;
  while (i + 8 <= buf.length) {
    const id = buf.toString("ascii", i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    if (id === "data") return Math.min(size, buf.length - i - 8) / byteRate;
    i += 8 + size + (size % 2);
  }
  return (buf.length - 44) / byteRate;
}

/** Returns a cached WAV clip of the text and its length in seconds. */
async function tts(text) {
  const key = createHash("sha1").update(`${VOICE}|${SPEED}|${text}`).digest("hex").slice(0, 16);
  const file = path.join(TTS_CACHE, `${key}.wav`);
  if (!existsSync(file)) {
    const res = await fetch(`${TTS_URL}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "kokoro", input: text, voice: VOICE, response_format: "wav", speed: SPEED, stream: false }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
    await mkdir(TTS_CACHE, { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  return { file, seconds: wavSeconds(await readFile(file)) };
}

// ---------- in-page overlay: cursor and page wipes ----------

/** Where the cursor is, shared with every new document. */
let cursorAt = { x: 640, y: 360 };

function overlayScript() {
  // Init scripts also run in iframes (Stripe embeds several); draw on the top page only.
  if (window.top !== window.self || location.protocol === "about:") return;
  const state = { x: 640, y: 360, label: "", covered: true };
  const fixed = (el, rules) =>
    el.setAttribute("style", ["all:initial", "display:block", "position:fixed", "margin:0", "transform:none", ...rules]
      .map((d) => `${d} !important`).join(";"));
  // Custom elements with a shadow root, so page styles never reach them. They are
  // looked up on every use and re-created if the page (or its hydration) removed them.
  const mount = (tag, build) => {
    let host = document.querySelector(tag);
    if (!host && document.documentElement) {
      host = document.createElement(tag);
      host.attachShadow({ mode: "open" });
      build(host);
      document.documentElement.appendChild(host);
    }
    return host;
  };

  const cursor = () => mount("appshelf-demo-cursor", (host) => {
    host.shadowRoot.innerHTML = `<style>
        svg{position:absolute;left:0;top:0;filter:drop-shadow(1px 2px 2px rgba(0,0,0,.35));transform-origin:3px 3px;transition:transform .09s}
        .down svg{transform:scale(.86)}
        .ring{position:absolute;left:-18px;top:-18px;width:36px;height:36px;border:3px solid #ffd400;border-radius:50%;box-sizing:border-box;opacity:0}
      </style><div class="c"><div class="ring"></div><svg width="26" height="32" viewBox="0 0 26 32">
        <path d="M3 2 L3 26 L9.5 20 L14 30 L18.5 28 L14 18.5 L23 18.5 Z" fill="#121212" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></div>`;
  });
  const place = (x, y) => {
    state.x = x;
    state.y = y;
    const host = cursor();
    if (host) fixed(host, [`left:${x}px`, `top:${y}px`, "width:0", "height:0", "z-index:2147483646", "pointer-events:none", "overflow:visible"]);
  };
  addEventListener("mousemove", (e) => place(e.clientX, e.clientY), { capture: true, passive: true });
  addEventListener("mousedown", () => {
    const c = cursor()?.shadowRoot.querySelector(".c");
    if (!c) return;
    c.classList.add("down");
    c.querySelector(".ring").animate(
      [{ opacity: 0.95, transform: "scale(.4)" }, { opacity: 0, transform: "scale(1.9)" }],
      { duration: 520, easing: "cubic-bezier(.2,.7,.3,1)" },
    );
  }, { capture: true });
  addEventListener("mouseup", () => cursor()?.shadowRoot.querySelector(".c")?.classList.remove("down"), { capture: true });

  // Page wipe: a signal-yellow slab with the destination's name.
  const slab = () => {
    const host = mount("appshelf-demo-wipe", (h) => {
      h.shadowRoot.innerHTML = `<style>
          .s{position:absolute;inset:0;background:#ffd400;color:#121212;display:flex;align-items:center;padding-left:96px;
            font:700 44px/1 "JetBrains Mono",ui-monospace,Consolas,monospace;letter-spacing:-.01em;transform:translateX(-100%)}
          .s b{display:inline-block;margin-right:22px}
        </style><div class="s"><span><b>→</b><span class="l"></span></span></div>`;
    });
    if (!host) return null;
    fixed(host, ["left:0", "top:0", "width:100vw", "height:100vh", "z-index:2147483645", "pointer-events:none"]);
    const s = host.shadowRoot.querySelector(".s");
    s.querySelector(".l").textContent = state.label;
    return s;
  };
  const labelFor = () => {
    if (location.hostname.startsWith("checkout.stripe")) return "Stripe Checkout · test mode";
    if (location.hostname.startsWith("wp.")) return "WordPress site";
    return location.pathname.startsWith("/dashboard") ? "AppShelf dashboard" : "AppShelf";
  };
  window.__demoWipe = (label) => {
    state.label = label;
    return slab()?.animate([{ transform: "translateX(-100%)" }, { transform: "translateX(0)" }],
      { duration: 340, easing: "cubic-bezier(.7,0,.84,0)", fill: "forwards" }).finished;
  };
  window.__demoReveal = () => {
    state.covered = false;
    const done = slab()?.animate([{ transform: "translateX(0)" }, { transform: "translateX(100%)" }],
      { duration: 420, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }).finished;
    return Promise.resolve(done).then(() => { window.__demoShown = true; });
  };

  // Timecode: wall-clock centiseconds (20 bits) plus a 4-bit nibble sum, drawn as
  // black/white bars on every frame. The edit reads it back to line frames up with
  // the script's events (Playwright's video clock drifts), then crops it off.
  const tc = () => mount("appshelf-demo-tc", (h) => {
    fixed(h, ["left:0", "bottom:0", "width:100%", "height:__TC_H__px", "z-index:2147483647", "pointer-events:none", "background:#000"]);
    h.shadowRoot.innerHTML = Array.from({ length: __TC_BITS__ }, (_, i) =>
      `<i style="position:absolute;top:0;bottom:0;left:${__TC_X__ + i * __TC_W__}px;width:__TC_W__px;background:#000"></i>`).join("");
  });
  const tick = () => {
    const bars = tc()?.shadowRoot.querySelectorAll("i");
    if (bars) {
      const cs = Math.floor(Date.now() / 10) % 1048576;
      let sum = 0;
      for (let k = 0; k < 20; k += 4) sum += (cs >> k) & 15;
      const code = cs | ((sum & 15) << 20);
      bars.forEach((b, i) => { b.style.background = (code >> i) & 1 ? "#fff" : "#000"; });
    }
    requestAnimationFrame(tick);
  };

  // A new document starts covered by the slab and is revealed once it has painted.
  state.label = labelFor();
  const boot = () => {
    if (!document.getElementById("__demo_fonts") && document.documentElement) {
      const link = document.createElement("link");
      link.id = "__demo_fonts";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@700&display=swap";
      document.documentElement.appendChild(link);
    }
    const s = slab();
    if (s && state.covered) s.style.transform = "translateX(0)";
    place(state.x, state.y);
    if (!state.ticking) {
      state.ticking = true;
      requestAnimationFrame(tick);
    }
  };
  if (document.documentElement) boot();
  else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); boot(); } })
    .observe(document, { childList: true });
  window.__getCursor?.().then((o) => place(o.x, o.y)).catch(() => {});
  // Hydration can drop foreign nodes from <html>; put the overlay back while the page settles.
  const keep = new MutationObserver(() => {
    if (!document.querySelector("appshelf-demo-cursor")) place(state.x, state.y);
    if (!document.querySelector("appshelf-demo-tc")) tc();
    if (state.covered && !document.querySelector("appshelf-demo-wipe")) boot();
  });
  const watch = () => document.documentElement && keep.observe(document.documentElement, { childList: true });
  if (document.documentElement) watch();
  else document.addEventListener("DOMContentLoaded", watch, { once: true });
  const reveal = () => setTimeout(() => window.__demoReveal(), 300);
  if (document.readyState === "complete") reveal();
  else addEventListener("load", reveal, { once: true });
}

/** Moves the cursor along a slightly curved, eased path, like a hand on a mouse. */
async function moveTo(page, x, y, slow = 1) {
  const { x: x0, y: y0 } = cursorAt;
  const dist = Math.hypot(x - x0, y - y0);
  const steps = Math.round(Math.max(12, Math.min(40, dist / 18)) * slow);
  const bend = Math.min(60, dist * 0.08);
  const nx = dist ? -(y - y0) / dist : 0, ny = dist ? (x - x0) / dist : 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    const arc = Math.sin(Math.PI * t) * bend;
    await page.mouse.move(x0 + (x - x0) * e + nx * arc, y0 + (y - y0) * e + ny * arc);
    await pause(10);
  }
  cursorAt = { x, y };
}

async function boxOf(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  return box;
}

/** Moves to the element and clicks it with a visible press. */
async function clickOn(page, locator, { dx = 0.5, dy = 0.5 } = {}) {
  const box = await boxOf(locator);
  await moveTo(page, box.x + box.width * dx, box.y + box.height * dy);
  await pause(120);
  await page.mouse.down();
  await pause(80);
  await page.mouse.up();
}

async function typeInto(page, locator, text) {
  await clickOn(page, locator, { dx: 0.3 });
  await fast(() => page.keyboard.type(text, { delay: 45 }));
}

// ---------- beats and highlight events (recording time) ----------

let videoStart = 0;
const now = () => (Date.now() - videoStart) / 1000;
const beats = [];
const events = [];
let cur = null;
let page = null;

async function beat(id) {
  await closeBeat();
  const clip = await tts(BEATS[id].line);
  cur = { id, ...BEATS[id], vo: clip.seconds, file: clip.file, start: now(), fast: [] };
}

/** Ends the beat; a beat shorter than its target gets a slow cursor drift, never a frozen frame. */
async function closeBeat() {
  if (!cur) return;
  const span = now() - cur.start;
  const short = Math.max(cur.target, cur.vo + 0.45) - span; // the edit can only shorten, never lengthen
  if (short > 0) {
    const { x, y } = cursorAt;
    const t0 = Date.now();
    while (Date.now() - t0 < short * 1000) await moveTo(page, x + 40 * Math.sin((Date.now() - t0) / 400), y + 12, 0.6);
  }
  cur.end = now();
  beats.push(cur);
  cur = null;
}

/** Marks dead time (typing, loads, waits) for the edit to fast-forward. */
async function fast(fn) {
  const a = now();
  try {
    return await fn();
  } finally {
    cur?.fast.push([a, now()]);
  }
}

/** Page CSS px -> edit px (after the crop and scale-up). */
const rectOf = (b) => {
  const sx = EDIT_W / CROP.w, sy = EDIT_H / CROP.h;
  return { x: (b.x - CROP.x) * sx, y: b.y * sy, w: b.width * sx, h: b.height * sy };
};
/** One box around several elements (a locator or an array of them). */
async function boxAround(target) {
  const boxes = await Promise.all([target].flat().map((l) => l.boundingBox()));
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.width)), btm = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: r - x, height: btm - y };
}
async function focus(locator, z = 1.4) {
  const b = rectOf(await boxAround(locator));
  events.push({ type: "zoom", t: now(), z, cx: b.x + b.w / 2, cy: b.y + b.h / 2 });
}
const unfocus = () => events.push({ type: "zoom", t: now(), z: 1 });
async function spot(locator) {
  events.push({ type: "spot", t: now(), ...rectOf(await boxAround(locator)) });
}
const unspot = () => events.push({ type: "unspot", t: now() });
const callout = (text, pos = "tr") => events.push({ type: "callout", t: now(), text, pos });
const uncallout = () => events.push({ type: "uncallout", t: now() });

// ---------- flow helpers ----------

/** Pays on Stripe Checkout with the 4242 test card. */
async function payWithTestCard({ highlight }) {
  await fast(async () => {
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
    await page.locator("#cardNumber").waitFor({ timeout: 60_000 });
    await pause(700);
  });
  // Checkout picks the local currency from the IP address; show the USD price.
  const usd = page.locator("button", { hasText: "USD" }).first();
  if (await usd.isVisible().catch(() => false)) {
    await clickOn(page, usd);
    // Switching currency re-renders the form; typing too early is dropped.
    await fast(() => pause(900));
  }
  const card = page.locator("#cardNumber");
  if (highlight) {
    const area = [card, page.locator("#cardExpiry"), page.locator("#cardCvc")];
    await focus(area, 1.45);
    await spot(area);
    callout("Stripe test card 4242 · 12/34 · 123", "tr");
  }
  await typeInto(page, card, "4242424242424242");
  await typeInto(page, page.locator("#cardExpiry"), "1234");
  await typeInto(page, page.locator("#cardCvc"), "123");
  for (const [sel, value] of [["#cardNumber", "4242424242424242"], ["#cardExpiry", "1234"], ["#cardCvc", "123"]]) {
    const field = page.locator(sel);
    if ((await field.inputValue()).replace(/\D/g, "") !== value) {
      await fast(async () => {
        await field.fill("");
        await field.click();
        await page.keyboard.type(value, { delay: 30 });
      });
    }
  }
  if (highlight) {
    unspot();
    uncallout();
    unfocus();
  }
  await typeInto(page, page.locator("#billingName"), "Demo Buyer");
  const country = page.locator("#billingCountry");
  if (await country.isVisible().catch(() => false)) {
    await fast(async () => {
      await country.selectOption("US");
      const zip = page.locator("#billingPostalCode");
      if (await zip.isVisible().catch(() => false)) {
        await zip.click();
        await page.keyboard.type("94107", { delay: 40 });
      }
    });
  }
  const submit = page.locator("button[type=submit]");
  await clickOn(page, submit);
  return Date.now();
}

const dashboardUrl = new RegExp(`^${APP.replace(/[.]/g, "\\.")}/dashboard`);

/** Waits for the dashboard (which refreshes itself) to show a status badge. */
async function waitForStatus(status, timeout = 120_000) {
  await page.locator("article .label", { hasText: new RegExp(`^${status}$`) }).first().waitFor({ timeout });
  // A fresh document is still under its reveal wipe; highlight only what is visible.
  await page.waitForFunction(() => window.__demoShown === true, null, { timeout: 10_000 }).catch(() => {});
}
const badges = () => page.locator("article .label", { hasText: /^Licence / }).first().locator("xpath=..");

/** Opens the site from the dashboard in the same tab, so the recording stays one video. */
async function openSite() {
  const link = page.locator("article a.text-link").first();
  await link.evaluate((a) => a.removeAttribute("target"));
  await clickOn(page, link, { dx: 0.35 });
  await page.evaluate(() => window.__demoWipe?.("WordPress site")).catch(() => {});
  await fast(async () => {
    await page.waitForURL(/wp\./);
    await page.waitForLoadState("load");
    await pause(450);
  });
}

async function backToDashboard() {
  await page.evaluate(() => window.__demoWipe?.("AppShelf dashboard")).catch(() => {});
  await fast(async () => {
    await page.goto(`${APP}/dashboard`, { waitUntil: "load" });
    await pause(450);
  });
}

// ---------- 1. record ----------

async function record() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  OUT = realpathSync.native(OUT); // Docker cannot mount 8.3 short paths
  const lines = [...Object.values(BEATS).map((b) => b.line), END_LINE];
  for (const [i, line] of lines.entries()) {
    await tts(line);
    console.log(`narration ${i + 1}/${lines.length}`);
  }

  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: VIEW,
    // The screencast is captured at CSS-pixel size whatever the scale factor,
    // so record at 1280x720 and scale the cut up to the 1920x1080 edit.
    deviceScaleFactor: 1,
    locale: "en-US",
    bypassCSP: true,
    recordVideo: { dir: OUT, size: VIEW },
  });
  await context.exposeFunction("__getCursor", () => cursorAt);
  const tcConsts = { __TC_H__: TC_H, __TC_BITS__: TC_BITS, __TC_X__: TC_X, __TC_W__: TC_W };
  await context.addInitScript(`(${overlayScript.toString().replace(/__TC_\w+__/g, (k) => tcConsts[k])})();`);
  page = await context.newPage();
  videoStart = Date.now();
  timings.tcBase = Math.floor(videoStart / 10) % 1048576;
  page.on("dialog", async (dialog) => {
    await pause(500);
    await dialog.accept();
  });

  await page.goto(APP, { waitUntil: "load" });
  timings.trimStart = Number(Math.max(0, now() - 0.1).toFixed(2));

  await beat("intro");
  const tag = page.locator("article").first();
  await pause(500);
  await focus(tag, 1.35);
  await spot(tag);
  callout("WordPress site · $9/month · Stripe test mode", "bl");
  await moveTo(page, 900, 330);
  await moveTo(page, 1000, 420, 1.4);
  await pause(400);
  unspot();
  uncallout();
  unfocus();

  await beat("templates");
  await fast(async () => {
    await page.evaluate(() => document.querySelector("#templates")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    await pause(900);
  });
  await spot(page.locator("#templates ul").first());
  for (const x of [300, 680, 1060]) await moveTo(page, x, 420);
  unspot();

  await beat("signup");
  await clickOn(page, page.getByRole("link", { name: "Use Restaurant" }));
  await fast(() => page.locator("#email").waitFor());
  await focus(page.locator("form").first(), 1.3);
  await typeInto(page, page.locator("#email"), email);
  await typeInto(page, page.locator("#password"), "demo-pass-2026");
  await clickOn(page, page.getByRole("button", { name: "Create account" }));
  await fast(() => page.waitForURL(/\/sites\/new/));
  unfocus();

  await beat("newSite");
  await clickOn(page, page.locator("label", { hasText: "Restaurant" }).first(), { dy: 0.3 });
  await focus(page.locator("#title"), 1.3);
  await typeInto(page, page.locator("#title"), siteTitle);
  await fast(() => page.fill("#slug", ""));
  await typeInto(page, page.locator("#slug"), slug);
  await fast(() => page.getByText("Available").waitFor({ timeout: 15_000 }).catch(() => {}));
  unfocus();
  await clickOn(page, page.getByRole("button", { name: "Continue to payment" }));
  await page.evaluate(() => window.__demoWipe?.("Stripe Checkout · test mode")).catch(() => {});

  await beat("pay");
  const paidAt = await payWithTestCard({ highlight: true });

  await beat("build");
  timings.timerFrom = (paidAt - videoStart) / 1000;
  await fast(() => page.waitForURL(dashboardUrl, { timeout: 90_000 }));
  callout("Webhook → job → WordPress", "tr");
  await spot(page.locator("article").first());
  await moveTo(page, 220, 520);
  await fast(() => waitForStatus("Live"));
  timings.liveSeconds = Math.round((Date.now() - paidAt) / 1000);
  timings.timerTo = now();
  uncallout();
  unspot();

  await beat("live");
  await focus(badges(), 1.6);
  await spot(badges());
  callout(`Site live in ${timings.liveSeconds} s`, "tr");
  await moveTo(page, 200, 500);
  await pause(300);
  unspot();
  uncallout();
  unfocus();

  await beat("site");
  await openSite();
  await focus(page.locator("h1, .wp-block-heading").first(), 1.2);
  await moveTo(page, 700, 300);
  await page.mouse.wheel(0, 380);
  await pause(500);
  unfocus();

  await beat("cancel");
  await backToDashboard();
  await clickOn(page, page.getByRole("button", { name: "Cancel plan" }));
  await fast(async () => {
    await page.waitForURL(/plan=cancelled/, { timeout: 30_000 });
    await waitForStatus("Archived");
  });
  await focus(badges(), 1.6);
  await spot(badges());
  callout("Licence inactive · site archived", "tr");
  await moveTo(page, 260, 500);
  await pause(300);
  unspot();
  uncallout();
  unfocus();

  await beat("archived");
  await openSite();
  await spot(page.getByText("archived or suspended").first());
  await moveTo(page, 520, 140);
  unspot();

  await beat("renew");
  await backToDashboard();
  await clickOn(page, page.getByRole("button", { name: "Renew" }));
  await page.evaluate(() => window.__demoWipe?.("Stripe Checkout · test mode")).catch(() => {});
  const renewedAt = await payWithTestCard({ highlight: false });

  await beat("back");
  await fast(async () => {
    await page.waitForURL(dashboardUrl, { timeout: 90_000 });
    await waitForStatus("Live");
  });
  timings.renewSeconds = Math.round((Date.now() - renewedAt) / 1000);
  await focus(badges(), 1.6);
  await spot(badges());
  callout(`Renewed · back online in ${timings.renewSeconds} s`, "tr");
  await moveTo(page, 220, 500);
  await pause(300);
  unspot();
  uncallout();
  unfocus();

  await beat("same");
  await openSite();
  await moveTo(page, 640, 420);
  await pause(400);
  await closeBeat();
  timings.recEnd = now();

  const video = page.video();
  await context.close();
  await browser.close();
  await rename(await video.path(), path.join(OUT, "recording.webm"));
  for (const f of await readdir(OUT)) if (f.endsWith(".webm") && f !== "recording.webm") await rm(path.join(OUT, f));
  await writeFile(path.join(OUT, "timings.json"), JSON.stringify({ ...timings, slug }, null, 2));
  console.log("recorded", timings);
}

// ---------- 2. edit plan ----------

function plan() {
  const segs = []; // { a, b, speed } in recording time
  const push = (a, b, speed) => b - a > 0.01 && segs.push({ a, b, speed });
  push(timings.trimStart, beats[0].start, MAX_SPEED);
  const beatEdits = [];
  let editT = TITLE + (beats[0].start - timings.trimStart) / MAX_SPEED;
  for (const bt of beats) {
    const fastIv = bt.fast.map(([a, b]) => [Math.max(a, bt.start), Math.min(b, bt.end)]).filter(([a, b]) => b > a)
      .sort((p, q) => p[0] - q[0]);
    const merged = [];
    for (const iv of fastIv) {
      const last = merged.at(-1);
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else merged.push([...iv]);
    }
    const F = merged.reduce((s, [a, b]) => s + b - a, 0);
    const N = bt.end - bt.start - F;
    const D = Math.max(bt.target, bt.vo + 0.45);
    let speed = 1;
    if (F > 0) speed = N >= D - 0.15 ? MAX_SPEED : Math.min(MAX_SPEED, F / (D - N));
    if (speed < 1.5) speed = 1;
    const at = editT;
    let t = bt.start;
    for (const [a, b] of merged) {
      push(t, a, 1);
      push(a, b, speed);
      t = b;
    }
    push(t, bt.end, 1);
    editT += N + F / speed;
    beatEdits.push({ id: bt.id, at, until: editT, line: bt.line, vo: bt.vo, file: bt.file });
  }
  const body = editT - TITLE;

  // Recording time -> edit time.
  const starts = [];
  let acc = TITLE;
  for (const s of segs) {
    starts.push(acc);
    acc += (s.b - s.a) / s.speed;
  }
  const map = (r) => {
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (r >= s.a) return starts[i] + (Math.min(r, s.b) - s.a) / s.speed;
    }
    return TITLE;
  };
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const bodyEnd = TITLE + body;

  const zooms = [];
  const zs = events.filter((e) => e.type === "zoom");
  zs.forEach((e, i) => {
    if (e.z === 1) return;
    const next = zs[i + 1];
    // Hold a zoom at least HOLD seconds (a shorter push-in reads as a jolt), but never past the next zoom.
    const at = map(e.t);
    const nextAt = next ? map(next.t) : bodyEnd - 0.6;
    const nextIn = zs.slice(i + 1).find((x) => x.z !== 1);
    const until = next && next.z !== 1 ? nextAt : Math.min(Math.max(nextAt, at + HOLD), nextIn ? map(nextIn.t) - 0.6 : bodyEnd - 0.6);
    zooms.push({ at: r3(at), until: r3(until), z: e.z, cx: Math.round(e.cx), cy: Math.round(e.cy), release: !next || next.z === 1 });
  });
  const span = (open, closeTypes, maxLen) => {
    const out = [];
    events.forEach((e, i) => {
      if (e.type !== open) return;
      const close = events.slice(i + 1).find((x) => closeTypes.includes(x.type));
      const at = map(e.t);
      const until = Math.min(close ? map(close.t) : bodyEnd, at + maxLen);
      if (until - at > 0.3) out.push({ ...e, at: r3(at), until: r3(until) });
    });
    return out;
  };
  const spots = span("spot", ["spot", "unspot"], 6).map(({ at, until, x, y, w, h }, i, all) => ({
    at, until: r3(Math.min(Math.max(until, at + HOLD), all[i + 1]?.at ?? bodyEnd)), x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }));
  const callouts = span("callout", ["callout", "uncallout"], 3.6).map(({ at, until, text, pos }) => ({ at, until: r3(Math.max(until, at + 1.4)), text, pos }));
  const speeds = [];
  segs.forEach((s, i) => {
    const len = (s.b - s.a) / s.speed;
    if (s.speed < 1.5 || len < 0.4) return;
    speeds.push({ at: r3(starts[i]), until: r3(starts[i] + len), speed: Math.round(s.speed) });
  });
  // The timer counts real seconds since the payment, also while the edit fast-forwards.
  const { timerFrom: from, timerTo: to } = timings;
  const keys = [[r3(map(from)), 0]];
  for (const sg of segs) if (sg.a > from && sg.a < to) keys.push([r3(map(sg.a)), r3(sg.a - from)]);
  keys.push([r3(map(to)), r3(to - from)]);
  const build = beatEdits.find((b) => b.id === "build");
  const timer = { at: r3(build.at), until: r3(map(to) + 1.2), label: "Since payment", keys };

  const captions = beatEdits.map((b, i) => ({
    at: r3(b.at + 0.1),
    until: r3(Math.min(beatEdits[i + 1]?.at ?? bodyEnd, b.at + 0.1 + b.vo + 0.9)),
    text: b.line,
  }));
  const edit = { title: TITLE, body: r3(body), end: END, duration: r3(TITLE + body + END), captions, zooms, spots, callouts, speeds, timer };
  const cues = [
    ...beatEdits.map((b) => ({ at: b.at + 0.1, file: b.file, seconds: b.vo, text: b.line })),
  ];
  return { segs, edit, cues };
}

// ---------- 3. build: body cut, composition render, mix ----------

function docker(args) {
  return execFileSync("docker", ["run", "--rm", "-v", `${OUT}:/w`, "-w", "/w", "linuxserver/ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
}

/**
 * Reads the timecode strip of every frame of recording.webm and returns
 * vOf(r): the video time at which the page first shows script time r.
 */
function videoClock() {
  const FPS = 30;
  const res = spawnSync("docker", ["run", "--rm", "-v", `${OUT}:/w`, "-w", "/w", "linuxserver/ffmpeg", "-hide_banner", "-loglevel", "error",
    "-i", "recording.webm", "-vf", `fps=${FPS},crop=${VIEW.width}:4:0:${VIEW.height - TC_H + 2},format=gray`, "-f", "rawvideo", "-"],
  { maxBuffer: 1 << 30 });
  if (res.status !== 0) throw new Error(`timecode read failed: ${res.stderr}`);
  const frame = VIEW.width * 4;
  const pts = [];
  let lastV = 0, lastR = -1;
  for (let k = 0; (k + 1) * frame <= res.stdout.length; k++) {
    const f = res.stdout.subarray(k * frame, (k + 1) * frame);
    let code = 0, ok = true;
    for (let i = 0; i < TC_BITS && ok; i++) {
      const x = TC_X + i * TC_W + TC_W / 2;
      const px = [];
      for (let row = 0; row < 4; row++) for (let dx = -8; dx <= 8; dx += 4) px.push(f[row * VIEW.width + x + dx]);
      px.sort((p, q) => p - q);
      const m = px[px.length >> 1];
      if (m > 70 && m < 185) ok = false;
      if (m >= 185) code |= 1 << i;
    }
    if (!ok) continue;
    const cs = code & 0xfffff;
    let sum = 0;
    for (let n = 0; n < 20; n += 4) sum += (cs >> n) & 15;
    if ((sum & 15) !== code >>> 20) continue;
    const r = ((cs - timings.tcBase + 1048576) % 1048576) / 100;
    const v = k / FPS;
    // Script time never runs ahead of video time by much; anything else is a misread.
    if (r < lastR || (lastR >= 0 && r - lastR > v - lastV + 1)) continue;
    pts.push([v, r]);
    lastV = v;
    lastR = r;
  }
  if (pts.length < 100) throw new Error(`timecode strip unreadable (${pts.length} frames)`);
  console.log(`timecode: ${pts.length} frames, drift ${(pts.at(-1)[0] - pts.at(-1)[1] - (pts[0][0] - pts[0][1])).toFixed(2)} s`);
  return (r) => {
    let lo = 0, hi = pts.length - 1;
    if (r >= pts[hi][1]) return pts[hi][0] + (r - pts[hi][1]);
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid][1] >= r) hi = mid;
      else lo = mid + 1;
    }
    return pts[lo][0];
  };
}

const vttTime = (s) => {
  const ms = Math.round(s * 1000);
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor(ms / 60_000) % 60).padStart(2, "0");
  const sec = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
  return `${h}:${m}:${sec}.${String(ms % 1000).padStart(3, "0")}`;
};

async function build() {
  const { segs, edit, cues } = plan();
  const endLine = await tts(END_LINE);
  cues.push({ at: TITLE + edit.body + 0.35, file: endLine.file, seconds: endLine.seconds, text: END_LINE });
  await writeFile(path.join(OUT, "edit.json"), JSON.stringify({ edit, segs }, null, 2));

  // Body: one piecewise-linear re-timing of the recording. Each segment's script
  // times map to video times through the timecode strip and to edit times through
  // its speed; the segments are contiguous, so a single setpts and a single fps
  // pass give frame-exact timing (per-segment fps rounding would add up).
  const vOf = videoClock();
  const knots = [];
  let o = 0;
  for (const sg of segs) {
    knots.push({ v: vOf(sg.a), o });
    o += (sg.b - sg.a) / sg.speed;
  }
  knots.push({ v: Math.max(vOf(segs.at(-1).b), knots.at(-1).v + 0.04), o });
  const f = (x) => x.toFixed(4);
  let expr = `${f(knots.at(-1).o)}+(T-${f(knots.at(-1).v)})`;
  for (let i = knots.length - 2; i >= 0; i--) {
    const k = knots[i], n = knots[i + 1];
    if (n.v - k.v < 1e-3) continue; // no video for this stretch: fps repeats the previous frame
    const slope = (n.o - k.o) / (n.v - k.v);
    expr = `if(lt(T,${f(n.v)}),${f(k.o)}+(T-${f(k.v)})*${slope.toFixed(5)},${expr})`;
  }
  const graph = `[0:v]trim=start=${f(knots[0].v)}:end=${f(knots.at(-1).v)},setpts='(${expr})/TB',fps=30,` +
    `tpad=stop_mode=clone:stop_duration=1,trim=duration=${f(o)},format=yuv420p,` +
    `crop=${CROP.w}:${CROP.h}:${CROP.x}:0,scale=${EDIT_W}:${EDIT_H}:flags=lanczos,setsar=1[out]`;
  await writeFile(path.join(OUT, "body.filter"), graph);
  docker(["-i", "recording.webm", "-/filter_complex", "body.filter", "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-an", "body.mp4"]);

  // Composition: body video + EDIT data, rendered by HyperFrames.
  await mkdir(path.join(EDIT_DIR, "assets"), { recursive: true });
  await copyFile(path.join(OUT, "body.mp4"), path.join(EDIT_DIR, "assets", "body.mp4"));
  const htmlPath = path.join(EDIT_DIR, "index.html");
  let html = await readFile(htmlPath, "utf8");
  html = html.replace(/\/\*EDIT:BEGIN\*\/[\s\S]*?\/\*EDIT:END\*\//, `/*EDIT:BEGIN*/window.EDIT=${JSON.stringify(edit)};/*EDIT:END*/`)
    .replace(/(data-composition-id="main" data-start="0" data-duration=")[\d.]+/, `$1${edit.duration}`)
    .replace(/(id="rec" class="clip" src="assets\/body.mp4" data-start=")[\d.]+(" data-duration=")[\d.]+/, `$1${TITLE}$2${edit.body}`);
  await writeFile(htmlPath, html);
  execSync("npx --yes hyperframes@0.8.77 render -o renders/appshelf-edit.mp4", { cwd: EDIT_DIR, stdio: "inherit" });
  await copyFile(path.join(EDIT_DIR, "renders", "appshelf-edit.mp4"), path.join(OUT, "edit.mp4"));

  // Music bed, as long as the video.
  execFileSync("python", ["-I", MUSIC, "--seconds", String(edit.duration), "--out", path.join(OUT, "bed.wav")]);

  // Mix: narration at -16 LUFS, the bed at -22 LUFS ducked under the voice, fades at both ends.
  await mkdir(path.join(OUT, "voice"), { recursive: true });
  const inputs = [];
  for (const [i, c] of cues.entries()) {
    const name = `voice/${String(i).padStart(2, "0")}.wav`;
    await copyFile(c.file, path.join(OUT, name));
    inputs.push("-i", name);
  }
  const n = cues.length;
  const total = edit.duration.toFixed(3);
  const a = cues.map((c, i) => `[${i + 2}:a]aresample=48000,adelay=${Math.round(c.at * 1000)}:all=1[c${i}]`).join(";") +
    `;${cues.map((_, i) => `[c${i}]`).join("")}amix=inputs=${n}:normalize=0,apad,atrim=0:${total},` +
    `loudnorm=I=-16:TP=-2:LRA=11,aresample=48000,aformat=channel_layouts=stereo,asplit[vo][key];` +
    `[1:a]aresample=48000,loudnorm=I=-22:TP=-4:LRA=7,aresample=48000,afade=t=in:d=1.2,afade=t=out:st=${(edit.duration - 1.6).toFixed(3)}:d=1.6[bed];` +
    `[bed][key]sidechaincompress=threshold=0.025:ratio=6:attack=15:release=380:makeup=1[duck];` +
    `[vo][duck]amix=inputs=2:normalize=0,alimiter=limit=0.89:level=false[aout];[0:v]scale=1280:720:flags=lanczos[vout]`;
  docker(["-i", "edit.mp4", "-i", "bed.wav", ...inputs, "-filter_complex", a, "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest", "appshelf-demo.mp4"]);

  await writeFile(path.join(OUT, "appshelf-demo.vtt"), `WEBVTT\n\n${cues
    .map((c, i) => `${i + 1}\n${vttTime(c.at)} --> ${vttTime(c.at + c.seconds + 0.2)}\n${c.text}\n`).join("\n")}`);
  const mb = (await stat(path.join(OUT, "appshelf-demo.mp4"))).size / 1e6;
  console.log(`video: ${path.join(OUT, "appshelf-demo.mp4")} (${edit.duration.toFixed(1)} s, ${mb.toFixed(1)} MB)`);
}

try {
  await record();
  await build();
} catch (error) {
  console.error(error);
  process.exit(1);
}
