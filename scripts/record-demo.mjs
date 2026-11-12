#!/usr/bin/env node
/**
 * Records the narrated, captioned demo video of the AppShelf purchase flow:
 * landing page, templates, sign-up, Stripe test checkout, provisioning, cancel
 * (archive) and renew (restore). Everything between the title and end cards is
 * a real recording of the running app.
 *
 * Usage (with the stack running, e.g. `scripts/appshelf.ps1 up`):
 *
 *   npm i --no-save playwright-core@1.56.1
 *   npx playwright-core install ffmpeg
 *   docker run -d --name kokoro-tts -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:v0.2.4
 *   (cd showcase/media/cards && npx --yes hyperframes@0.8.77 render -o renders/appshelf-cards.mp4)
 *   node scripts/record-demo.mjs [outDir]
 *
 * It drives the installed Google Chrome (channel "chrome") at 1280x720 with a
 * visible cursor that moves and clicks like a person, a yellow wipe between
 * pages, and a caption bar that shows each narration line as it is spoken.
 * Narration is generated locally by Kokoro TTS (Apache-2.0 model) through the
 * OpenAI-compatible endpoint at TTS_URL, and cached between runs.
 *
 * Output in outDir (default `<os tmpdir>/appshelf-demo`, outside the repo):
 * `appshelf-demo.webm` (raw recording), `narration.json`, `timings.json`, and,
 * when the rendered cards exist, `appshelf-demo.mp4` (H.264 + AAC, faststart)
 * and `appshelf-demo.vtt`. The splice and audio mix run in Docker
 * (linuxserver/ffmpeg): title card, recording from `trimStart`, end card, with
 * every narration clip placed where its caption appeared.
 *
 * Environment: APP_URL (default http://app.appshelf.localhost), TTS_URL
 * (default http://localhost:8880), TTS_VOICE (default af_heart), CARDS
 * (default showcase/media/cards/renders/appshelf-cards.mp4). Each run signs up
 * a fresh throwaway user; its site deletes itself after 48 hours.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const APP = (process.env.APP_URL ?? "http://app.appshelf.localhost").replace(/\/$/, "");
const TTS_URL = (process.env.TTS_URL ?? "http://localhost:8880").replace(/\/$/, "");
const VOICE = process.env.TTS_VOICE ?? "af_heart";
const CARDS = path.resolve(process.env.CARDS ?? "showcase/media/cards/renders/appshelf-cards.mp4");
let OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "appshelf-demo"));
const TTS_CACHE = path.join(os.tmpdir(), "appshelf-demo-tts");
const SIZE = { width: 1280, height: 720 };
const FONTS =
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Space+Grotesk:wght@500;700&display=swap";
// Scene lengths of the card composition (showcase/media/cards/data/script.json).
const TITLE_SECONDS = 4.6;
const CARDS_SECONDS = 11;
// Spoken over the cards; they are placed in the mix, not in the recording.
const TITLE_LINE = "AppShelf. A personal demo project, running in Stripe test mode.";
const END_LINE = "It's built with Next.js, Postgres, Stripe and WordPress. The code is on GitHub.";

// Narration, in order. Lines with measured numbers are generated during the run.
const LINES = {
  intro: "This is AppShelf, a small SaaS that sells hosted WordPress sites.",
  testMode: "Payments run in Stripe test mode, and every site deletes itself after forty-eight hours.",
  templates: "There are three templates on the shelf: a restaurant, an agency, and a services business.",
  signup: "I'll pick the restaurant and sign up with a throwaway account. There's no email check in the demo.",
  newSite: "Choose the template, give the site a title, and pick its address on the network.",
  toStripe: "Continue to payment hands over to Stripe Checkout.",
  pay: "This is Stripe's own hosted checkout. I pay with the test card, four two four two.",
  noMoney: "No real money moves: this Stripe account is in test mode.",
  worker: "Back on the dashboard, the payment is confirmed and a background worker builds the WordPress site.",
  site: "Here it is: the restaurant template on its own address, ready to edit in WordPress.",
  cancel: "Now cancel the plan. The licence turns inactive, and the site is archived right away.",
  archived: "Visitors now see that the site is archived.",
  renew: "Renewing goes through Stripe again, with the same test card.",
  payAgain: "Same card, four two four two, and pay.",
  restore: "The worker restores the archived site.",
  back: "The same site, with the same content, is back online.",
};

// Kokoro on CPU takes ~15 s per line, so the measured-number lines are cached for 3-12 s.
const NUMBERED = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const liveLine = (n) => NUMBERED.includes(n) ? `The site is live ${n} seconds after the payment.` : "The site is live a few seconds after the payment.";
const backLine = (n) => NUMBERED.includes(n) ? `${n} seconds later, it's live again.` : "A few seconds later, it's live again.";

const run = Date.now().toString(36);
const email = `demo-${run}@example.com`;
const siteTitle = "Luna Bistro";
const slug = `luna-bistro-${run}`;
const timings = {};
const narration = [];

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
  const key = createHash("sha1").update(`${VOICE}|1.0|${text}`).digest("hex").slice(0, 16);
  const file = path.join(TTS_CACHE, `${key}.wav`);
  if (!existsSync(file)) {
    const res = await fetch(`${TTS_URL}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "kokoro", input: text, voice: VOICE, response_format: "wav", speed: 1.0, stream: false }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
    await mkdir(TTS_CACHE, { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  return { file, seconds: wavSeconds(await readFile(file)) };
}

let videoStart = 0;
let speakingUntil = 0;

/** Waits for the current line, then speaks the next one and shows it as the caption. */
async function say(page, step, text) {
  const clip = await tts(text);
  await pause(Math.max(0, speakingUntil - Date.now()) + 350);
  narration.push({ at: (Date.now() - videoStart) / 1000, seconds: clip.seconds, file: clip.file, step, text });
  speakingUntil = Date.now() + clip.seconds * 1000;
  await setCaption(page, step, text);
}

const speechDone = async (extra = 300) => pause(Math.max(0, speakingUntil - Date.now()) + extra);

// ---------- in-page overlay: caption bar, cursor, page wipes ----------

/** Shared with every new document: the caption and where the cursor is. */
let overlay = { step: "", text: "", x: 640, y: 360 };

function overlayScript() {
  // Init scripts also run in iframes (Stripe embeds several); draw on the top page only.
  if (window.top !== window.self || location.protocol === "about:") return;
  const FONTS_URL = "__FONTS__";
  const state = { caption: { step: "", text: "" }, x: 640, y: 360, label: "", covered: true };
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
  const fonts = () => {
    if (document.getElementById("__demo_fonts") || !document.documentElement) return;
    const link = document.createElement("link");
    link.id = "__demo_fonts";
    link.rel = "stylesheet";
    link.href = FONTS_URL;
    document.documentElement.appendChild(link);
  };

  // Caption bar: step chip plus the narration line, wrapping to two lines if needed.
  const renderCaption = (c) => {
    state.caption = c;
    const old = document.querySelector("appshelf-demo-caption");
    if (!c.text) return old?.remove();
    const host = mount("appshelf-demo-caption", () => {});
    if (!host) return;
    fixed(host, ["left:0", "right:0", "bottom:0", "top:auto", "width:100vw", "z-index:2147483646", "pointer-events:none"]);
    host.shadowRoot.innerHTML = `<style>
        .bar{display:flex;align-items:stretch;min-height:58px;background:#121212;color:#fff;border-top:4px solid #ffd400;
          font:500 18px/1.4 "JetBrains Mono",ui-monospace,Consolas,monospace;box-sizing:border-box}
        .step{display:flex;align-items:center;padding:0 20px;background:#ffd400;color:#121212;font-weight:700;white-space:nowrap}
        .text{display:flex;align-items:center;padding:9px 22px}
      </style><div class="bar">${c.step ? `<div class="step">${c.step}</div>` : ""}<div class="text"></div></div>`;
    host.shadowRoot.querySelector(".text").textContent = c.text;
  };

  // Cursor: follows real mouse events (so hover states are real) and ripples on press.
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
    if (host) fixed(host, [`left:${x}px`, `top:${y}px`, "width:0", "height:0", "z-index:2147483647", "pointer-events:none", "overflow:visible"]);
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
    const p = location.pathname;
    return p.startsWith("/dashboard") ? "AppShelf dashboard" : p.startsWith("/signup") ? "Sign up"
      : p.startsWith("/sites/new") ? "New site" : "AppShelf";
  };
  window.__demoWipe = (label) => {
    state.label = label;
    const s = slab();
    return s?.animate([{ transform: "translateX(-100%)" }, { transform: "translateX(0)" }],
      { duration: 380, easing: "cubic-bezier(.7,0,.84,0)", fill: "forwards" }).finished;
  };
  window.__demoReveal = () => {
    state.covered = false;
    const s = slab();
    return s?.animate([{ transform: "translateX(0)" }, { transform: "translateX(100%)" }],
      { duration: 460, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }).finished;
  };
  window.__renderCaption = renderCaption;

  // A new document starts covered by the slab and is revealed once it has painted.
  state.label = labelFor();
  const boot = () => {
    fonts();
    const s = slab();
    if (s && state.covered) s.style.transform = "translateX(0)";
    place(state.x, state.y);
    if (state.caption.text) renderCaption(state.caption);
  };
  if (document.documentElement) boot();
  else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); boot(); } })
    .observe(document, { childList: true });
  window.__getOverlay?.().then((o) => {
    state.x = o.x;
    state.y = o.y;
    state.caption = { step: o.step, text: o.text };
    boot();
  }).catch(() => {});
  // Hydration can drop foreign nodes from <html>; put the overlay back while the page settles.
  const keep = new MutationObserver(() => {
    if (!document.querySelector("appshelf-demo-cursor")) place(state.x, state.y);
    if (state.caption.text && !document.querySelector("appshelf-demo-caption")) renderCaption(state.caption);
    if (state.covered && !document.querySelector("appshelf-demo-wipe")) boot();
  });
  const watch = () => document.documentElement && keep.observe(document.documentElement, { childList: true });
  if (document.documentElement) watch();
  else document.addEventListener("DOMContentLoaded", watch, { once: true });
  const reveal = () => setTimeout(() => window.__demoReveal(), 380);
  if (document.readyState === "complete") reveal();
  else addEventListener("load", reveal, { once: true });
}

async function setCaption(page, step, text) {
  overlay = { ...overlay, step, text };
  await page.evaluate((c) => window.__renderCaption?.(c), overlay).catch(() => {});
}

/** Moves the cursor along a slightly curved, eased path, like a hand on a mouse. */
async function moveTo(page, x, y) {
  const { x: x0, y: y0 } = overlay;
  const dist = Math.hypot(x - x0, y - y0);
  const steps = Math.max(14, Math.min(44, Math.round(dist / 16)));
  const bend = Math.min(60, dist * 0.08);
  const nx = dist ? -(y - y0) / dist : 0, ny = dist ? (x - x0) / dist : 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    const arc = Math.sin(Math.PI * t) * bend;
    await page.mouse.move(x0 + (x - x0) * e + nx * arc, y0 + (y - y0) * e + ny * arc);
    await pause(11);
  }
  overlay = { ...overlay, x, y };
}

/** Moves to the element and clicks it with a visible press. */
async function clickOn(page, locator, { dx = 0.5, dy = 0.5 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  await moveTo(page, box.x + box.width * dx, box.y + box.height * dy);
  await pause(160);
  await page.mouse.down();
  await pause(90);
  await page.mouse.up();
}

async function typeInto(page, locator, text) {
  await clickOn(page, locator, { dx: 0.3 });
  await pause(150);
  await page.keyboard.type(text, { delay: 65 });
}

async function smoothScrollTo(page, selector) {
  await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ behavior: "smooth", block: "start" }), selector);
  await pause(1300);
}

// ---------- flow helpers ----------

/** Pays on Stripe Checkout with the 4242 test card. */
async function payWithTestCard(page, step, lines) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  await page.locator("#cardNumber").waitFor({ timeout: 60_000 });
  await pause(900);
  await say(page, step, lines[0]);
  // Checkout picks the local currency from the IP address; show the USD price.
  const usd = page.locator("button", { hasText: "USD" }).first();
  if (await usd.isVisible().catch(() => false)) {
    await clickOn(page, usd);
    await pause(900);
  }
  await typeInto(page, page.locator("#cardNumber"), "4242424242424242");
  await typeInto(page, page.locator("#cardExpiry"), "1234");
  await typeInto(page, page.locator("#cardCvc"), "123");
  if (lines[1]) await say(page, step, lines[1]);
  await typeInto(page, page.locator("#billingName"), "Demo Buyer");
  const country = page.locator("#billingCountry");
  if (await country.isVisible().catch(() => false)) {
    const box = await country.boundingBox();
    if (box) await moveTo(page, box.x + box.width * 0.4, box.y + box.height / 2);
    await country.selectOption("US");
    const zip = page.locator("#billingPostalCode");
    if (await zip.isVisible().catch(() => false)) await typeInto(page, zip, "94107");
  }
  await speechDone(200);
  const submit = page.locator("button[type=submit]");
  await submit.scrollIntoViewIfNeeded();
  await pause(500);
  const paidAt = Date.now();
  await clickOn(page, submit);
  await page.waitForURL(new RegExp(`^${APP.replace(/[.]/g, "\\.")}/dashboard`), { timeout: 90_000 });
  return paidAt;
}

/** Waits for the dashboard (which refreshes itself) to show a status badge. */
async function waitForStatus(page, status, timeout = 120_000) {
  await page.locator("article .label", { hasText: new RegExp(`^${status}$`) }).first().waitFor({ timeout });
}

/** Opens the site from the dashboard in the same tab, so the recording stays one video. */
async function openSite(page) {
  const link = page.locator("article a.text-link").first();
  await link.evaluate((a) => a.removeAttribute("target"));
  await clickOn(page, link, { dx: 0.35 });
  await page.evaluate(() => window.__demoWipe?.("WordPress site")).catch(() => {});
  await page.waitForURL(/wp\./);
  await page.waitForLoadState("load");
}

async function backToDashboard(page) {
  await page.evaluate(() => window.__demoWipe?.("AppShelf dashboard")).catch(() => {});
  await page.goto(`${APP}/dashboard`, { waitUntil: "load" });
  await pause(500);
}

// ---------- recording ----------

async function record() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  OUT = realpathSync.native(OUT); // Docker cannot mount 8.3 short paths
  // Generate the fixed lines up front so the recording never waits on the TTS.
  const all = [TITLE_LINE, END_LINE, ...Object.values(LINES), ...[0, ...NUMBERED].flatMap((n) => [liveLine(n), backLine(n)])];
  for (const [i, line] of all.entries()) {
    await tts(line);
    console.log(`narration ${i + 1}/${all.length}`);
  }

  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    locale: "en-US",
    bypassCSP: true,
    recordVideo: { dir: OUT, size: SIZE },
  });
  await context.exposeFunction("__getOverlay", () => overlay);
  await context.addInitScript(`(${overlayScript.toString().replace("__FONTS__", FONTS)})();`);
  const page = await context.newPage();
  videoStart = Date.now();
  page.on("dialog", async (dialog) => {
    await pause(900);
    await dialog.accept();
  });

  // 1. Landing page.
  await page.goto(APP, { waitUntil: "load" });
  timings.trimStart = Number(Math.max(0, (Date.now() - videoStart) / 1000 - 0.15).toFixed(2));
  await pause(700);
  await say(page, "1 / 8", LINES.intro);
  await moveTo(page, 420, 520);
  await say(page, "1 / 8", LINES.testMode);
  await moveTo(page, 560, 610);
  await speechDone(0);

  // 2. Templates.
  await say(page, "2 / 8", LINES.templates);
  await smoothScrollTo(page, "#templates");
  await moveTo(page, 300, 430);
  await pause(600);
  await moveTo(page, 720, 440);
  await pause(600);
  await moveTo(page, 1080, 430);
  await speechDone(200);

  // 3. Sign up.
  await say(page, "3 / 8", LINES.signup);
  await clickOn(page, page.getByRole("link", { name: "Use Restaurant" }));
  await page.waitForURL(/\/signup/);
  await page.locator("#email").waitFor();
  await typeInto(page, page.locator("#email"), email);
  await typeInto(page, page.locator("#password"), "demo-pass-2026");
  await speechDone(200);
  await clickOn(page, page.getByRole("button", { name: "Create account" }));
  await page.waitForURL(/\/sites\/new/);

  // 4. Template and title.
  await say(page, "4 / 8", LINES.newSite);
  await clickOn(page, page.locator("label", { hasText: "Restaurant" }).first(), { dy: 0.3 });
  await typeInto(page, page.locator("#title"), siteTitle);
  await page.fill("#slug", "");
  await typeInto(page, page.locator("#slug"), slug);
  await page.getByText("Available").waitFor({ timeout: 15_000 }).catch(() => {});
  await speechDone(200);
  await say(page, "4 / 8", LINES.toStripe);
  await clickOn(page, page.getByRole("button", { name: "Continue to payment" }));
  await page.evaluate(() => window.__demoWipe?.("Stripe Checkout · test mode")).catch(() => {});

  // 5. Stripe Checkout.
  const paidAt = await payWithTestCard(page, "5 / 8", [LINES.pay, LINES.noMoney]);

  // 6. Provisioning.
  await say(page, "6 / 8", LINES.worker);
  await moveTo(page, 160, 520);
  await waitForStatus(page, "Live");
  timings.liveSeconds = Math.round((Date.now() - paidAt) / 1000);
  await say(page, "6 / 8", liveLine(timings.liveSeconds));
  await speechDone(200);
  await openSite(page);
  await say(page, "6 / 8", LINES.site);
  await moveTo(page, 700, 300);
  await page.mouse.wheel(0, 420);
  await speechDone(400);

  // 7. Cancel.
  await backToDashboard(page);
  await say(page, "7 / 8", LINES.cancel);
  await clickOn(page, page.getByRole("button", { name: "Cancel plan" }));
  await page.waitForURL(/plan=cancelled/, { timeout: 30_000 });
  await waitForStatus(page, "Archived");
  await speechDone(300);
  await openSite(page);
  await say(page, "7 / 8", LINES.archived);
  await moveTo(page, 520, 140);
  await speechDone(500);

  // 8. Renew.
  await backToDashboard(page);
  await say(page, "8 / 8", LINES.renew);
  await clickOn(page, page.getByRole("button", { name: "Renew" }));
  await page.evaluate(() => window.__demoWipe?.("Stripe Checkout · test mode")).catch(() => {});
  const renewedAt = await payWithTestCard(page, "8 / 8", [LINES.payAgain]);
  await say(page, "8 / 8", LINES.restore);
  await waitForStatus(page, "Live");
  timings.renewSeconds = Math.round((Date.now() - renewedAt) / 1000);
  await say(page, "8 / 8", backLine(timings.renewSeconds));
  await speechDone(200);
  await openSite(page);
  await say(page, "8 / 8", LINES.back);
  await moveTo(page, 640, 420);
  await speechDone(900);

  const video = page.video();
  await context.close();
  await browser.close();
  await rename(await video.path(), path.join(OUT, "appshelf-demo.webm"));
  for (const f of await readdir(OUT)) if (f.endsWith(".webm") && f !== "appshelf-demo.webm") await rm(path.join(OUT, f));
  await writeFile(path.join(OUT, "timings.json"), JSON.stringify({ ...timings, slug }, null, 2));
  await writeFile(path.join(OUT, "narration.json"), JSON.stringify(narration, null, 2));
  console.log("recorded", timings);
}

// ---------- assembly: cards + recording + narration (ffmpeg in Docker) ----------

const vttTime = (s) => {
  const ms = Math.round(s * 1000);
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor(ms / 60_000) % 60).padStart(2, "0");
  const sec = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
  return `${h}:${m}:${sec}.${String(ms % 1000).padStart(3, "0")}`;
};

function docker(args) {
  return execFileSync("docker", ["run", "--rm", "-v", `${OUT}:/w`, "-w", "/w", ...args], { encoding: "utf8" });
}

async function assemble() {
  if (!existsSync(CARDS)) {
    console.log(`no rendered cards at ${CARDS}; skipping the MP4`);
    return;
  }
  await copyFile(CARDS, path.join(OUT, "appshelf-cards.mp4"));
  const recSeconds = Number(docker(["--entrypoint", "ffprobe", "linuxserver/ffmpeg", "-v", "error", "-show_entries",
    "format=duration", "-of", "csv=p=0", "appshelf-demo.webm"]).trim());
  const body = recSeconds - timings.trimStart;
  const endStart = TITLE_SECONDS + body;
  const total = endStart + (CARDS_SECONDS - TITLE_SECONDS);

  // Final-timeline cues: the title line, every recorded line, the end line.
  const title = await tts(TITLE_LINE);
  const end = await tts(END_LINE);
  const cues = [
    { at: 0.5, ...title, text: TITLE_LINE },
    ...narration.map((n) => ({ ...n, at: TITLE_SECONDS + n.at - timings.trimStart })),
    { at: endStart + 0.6, ...end, text: END_LINE },
  ];
  await mkdir(path.join(OUT, "voice"), { recursive: true });
  const inputs = [];
  for (const [i, c] of cues.entries()) {
    const name = `voice/${String(i).padStart(2, "0")}.wav`;
    await copyFile(c.file, path.join(OUT, name));
    inputs.push("-i", name);
  }
  await writeFile(path.join(OUT, "appshelf-demo.vtt"), `WEBVTT\n\n${cues
    .map((c, i) => `${i + 1}\n${vttTime(c.at)} --> ${vttTime(c.at + c.seconds + 0.2)}\n${c.text}\n`)
    .join("\n")}`);

  const v = `[1:v]scale=1280:720:flags=lanczos,fps=30,format=yuv420p,setsar=1,split[c1][c2];` +
    `[c1]trim=0:${TITLE_SECONDS},setpts=PTS-STARTPTS[a];[c2]trim=${TITLE_SECONDS}:${CARDS_SECONDS},setpts=PTS-STARTPTS[c];` +
    `[0:v]trim=start=${timings.trimStart},setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[b];` +
    `[a][b][c]concat=n=3:v=1:a=0[v]`;
  const a = cues.map((c, i) => `[${i + 2}:a]aresample=48000,adelay=${Math.round(c.at * 1000)}:all=1[s${i}]`).join(";") +
    `;${cues.map((_, i) => `[s${i}]`).join("")}amix=inputs=${cues.length}:normalize=0,` +
    `loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:${total.toFixed(3)}[aout]`;
  docker(["linuxserver/ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", "appshelf-demo.webm", "-i", "appshelf-cards.mp4",
    ...inputs, "-filter_complex", `${v};${a}`, "-map", "[v]", "-map", "[aout]", "-c:v", "libx264", "-preset", "slow",
    "-crf", "24", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest",
    "appshelf-demo.mp4"]);
  const mb = (await stat(path.join(OUT, "appshelf-demo.mp4"))).size / 1e6;
  console.log(`video: ${path.join(OUT, "appshelf-demo.mp4")} (${total.toFixed(1)} s, ${mb.toFixed(1)} MB)`);
}

try {
  await record();
  await assemble();
} catch (error) {
  console.error(error);
  process.exit(1);
}
