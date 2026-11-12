#!/usr/bin/env node
/**
 * Records the narration-free, captioned demo video of the AppShelf purchase
 * flow: landing page, templates, sign-up, Stripe test checkout, provisioning,
 * cancel (archive) and renew (restore).
 *
 * Usage (with the stack running, e.g. `scripts/appshelf.ps1 up`):
 *
 *   npm i --no-save playwright-core@1.56.1
 *   npx playwright-core install ffmpeg
 *   node scripts/record-demo.mjs [outDir]
 *
 * It drives the installed Google Chrome (channel "chrome") at 1280x720 and
 * writes `<outDir>/appshelf-demo.webm` plus `timings.json` (default outDir:
 * `<os tmpdir>/appshelf-demo`, outside the repo). `timings.trimStart` is where
 * the landing page is on screen, so the blank first frames can be cut.
 *
 * The animated title and end cards are a HyperFrames composition in
 * `showcase/media/cards` (silent, 1920x1080, 30 fps; scene lengths in its
 * data/script.json). Render it, then splice cards and recording into the MP4
 * with ffmpeg in Docker, from a folder holding both files (T = trimStart):
 *
 *   (cd showcase/media/cards && npx --yes hyperframes@0.8.77 render -o renders/appshelf-cards.mp4)
 *   docker run --rm -v "$PWD:/w" -w /w linuxserver/ffmpeg \
 *     -i appshelf-demo.webm -i appshelf-cards.mp4 -filter_complex \
 *     "[1:v]scale=1280:720:flags=lanczos,fps=30,format=yuv420p,setsar=1,split[c1][c2]; \
 *      [c1]trim=0:4.6,setpts=PTS-STARTPTS[a]; [c2]trim=4.6:11,setpts=PTS-STARTPTS[c]; \
 *      [0:v]trim=start=T,setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[b]; \
 *      [a][b][c]concat=n=3:v=1:a=0[v]" -map "[v]" -c:v libx264 -preset slow -crf 24 \
 *     -pix_fmt yuv420p -movflags +faststart -an appshelf-demo.mp4
 *
 * The poster is one frame of that MP4: `-ss <t> -i appshelf-demo.mp4 -frames:v 1 poster.png`.
 *
 * Environment: APP_URL (default http://app.appshelf.localhost). Each run signs
 * up a fresh throwaway user; its site deletes itself after 48 hours.
 */
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const APP = (process.env.APP_URL ?? "http://app.appshelf.localhost").replace(/\/$/, "");
const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "appshelf-demo"));
const SIZE = { width: 1280, height: 720 };
const FONTS =
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Space+Grotesk:wght@500;700&display=swap";

const run = Date.now().toString(36);
const email = `demo-${run}@example.com`;
const siteTitle = "Luna Bistro";
const slug = `luna-bistro-${run}`;
const timings = {};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** The caption bar is re-created on every document from the current text. */
let caption = { step: "", text: "" };

function captionScript() {
  // Init scripts also run in iframes (Stripe embeds several); caption the top page only.
  if (window.top !== window.self) return;
  const FONTS_URL = "__FONTS__";
  const render = (c) => {
    if (!document.documentElement) return;
    let host = document.getElementById("__demo_caption");
    if (!c || !c.text) {
      host?.remove();
      return;
    }
    if (!document.getElementById("__demo_fonts")) {
      const link = document.createElement("link");
      link.id = "__demo_fonts";
      link.rel = "stylesheet";
      link.href = FONTS_URL;
      document.documentElement.appendChild(link);
    }
    if (!host) {
      // A custom element, so page rules aimed at div never reach it.
      host = document.createElement("appshelf-demo-caption");
      host.id = "__demo_caption";
      host.attachShadow({ mode: "open" });
      document.documentElement.appendChild(host);
    }
    host.setAttribute(
      "style",
      ["all:initial", "display:block", "position:fixed", "left:0", "right:0", "bottom:0", "top:auto", "width:100vw",
        "height:56px", "transform:none", "margin:0", "z-index:2147483647", "pointer-events:none"]
        .map((d) => `${d} !important`)
        .join(";"),
    );
    host.shadowRoot.innerHTML = `
      <style>
        .bar{display:flex;align-items:stretch;height:56px;background:#121212;color:#fff;
          border-top:4px solid #ffd400;font:500 19px/1 "JetBrains Mono",ui-monospace,Consolas,monospace;
          letter-spacing:.01em;box-sizing:border-box}
        .step{display:flex;align-items:center;padding:0 22px;background:#ffd400;color:#121212;font-weight:700}
        .text{display:flex;align-items:center;padding:0 22px;white-space:nowrap;overflow:hidden}
        .tag{margin-left:auto;display:flex;align-items:center;padding:0 22px;color:#9a9a9a;font-size:14px;
          text-transform:uppercase;letter-spacing:.12em}
      </style>
      <div class="bar">
        ${c.step ? `<div class="step">${c.step}</div>` : ""}
        <div class="text"></div>
        <div class="tag">AppShelf · Stripe test mode</div>
      </div>`;
    host.shadowRoot.querySelector(".text").textContent = c.text;
  };
  window.__renderCaption = render;
  const boot = () => window.__getCaption?.().then(render).catch(() => {});
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}

async function setCaption(page, step, text) {
  caption = { step, text };
  await page.evaluate((c) => window.__renderCaption?.(c), caption).catch(() => {});
}

async function typeSlow(page, selector, text) {
  await page.click(selector);
  await page.locator(selector).pressSequentially(text, { delay: 70 });
}

async function smoothScrollTo(page, selector) {
  await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ behavior: "smooth", block: "start" }), selector);
  await pause(1400);
}

/** Pays on Stripe Checkout with the 4242 test card. */
async function payWithTestCard(page, label) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  await page.locator("#cardNumber").waitFor({ timeout: 60_000 });
  await setCaption(page, label.step, label.text);
  await pause(1500);
  // Checkout picks the local currency from the IP address; show the USD price.
  const usd = page.locator("button", { hasText: "USD" }).first();
  if (await usd.isVisible().catch(() => false)) {
    await usd.click();
    await pause(1200);
  }
  await typeSlow(page, "#cardNumber", "4242424242424242");
  await typeSlow(page, "#cardExpiry", "1234");
  await typeSlow(page, "#cardCvc", "123");
  await typeSlow(page, "#billingName", "Demo Buyer");
  const country = page.locator("#billingCountry");
  if (await country.isVisible().catch(() => false)) {
    await country.selectOption("US");
    const zip = page.locator("#billingPostalCode");
    if (await zip.isVisible().catch(() => false)) await typeSlow(page, "#billingPostalCode", "94107");
  }
  await page.locator("#cardNumber").scrollIntoViewIfNeeded();
  await pause(1800);
  const submit = page.locator("button[type=submit]");
  await submit.scrollIntoViewIfNeeded();
  await pause(600);
  const paidAt = Date.now();
  await submit.click();
  await page.waitForURL(new RegExp(`^${APP.replace(/[.]/g, "\\.")}/dashboard`), { timeout: 90_000 });
  return paidAt;
}

/** Waits for the dashboard (which refreshes itself) to show a status badge. */
async function waitForStatus(page, status, timeout = 120_000) {
  await page.locator("article .label", { hasText: new RegExp(`^${status}$`) }).first().waitFor({ timeout });
}

/** Opens the site from the dashboard; the next document shows the given caption. */
async function openSite(page, step, text) {
  const link = page.locator("article a.text-link").first();
  // Same tab, so the recording stays one continuous video.
  await link.evaluate((a) => a.removeAttribute("target"));
  await link.hover();
  await pause(700);
  caption = { step, text };
  await link.click();
  await page.waitForLoadState("load");
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: "chrome", slowMo: 60 });
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    locale: "en-US",
    bypassCSP: true,
    recordVideo: { dir: OUT, size: SIZE },
  });
  await context.exposeFunction("__getCaption", () => caption);
  await context.addInitScript(`(${captionScript.toString().replace("__FONTS__", FONTS)})();`);
  const page = await context.newPage();
  const videoStart = Date.now();
  page.on("dialog", async (dialog) => {
    await pause(1200);
    await dialog.accept();
  });

  // Landing page and the three templates.
  await page.goto(APP, { waitUntil: "load" });
  await setCaption(page, "1 / 8", "Landing page: hosted WordPress sites, billed by Stripe");
  timings.trimStart = Number(Math.max(0, (Date.now() - videoStart) / 1000 - 0.2).toFixed(2));
  await pause(3000);
  await setCaption(page, "2 / 8", "Three templates on the shelf: restaurant, agency, services");
  await smoothScrollTo(page, "#templates");
  await pause(3500);

  // Sign up a fresh throwaway user.
  await setCaption(page, "3 / 8", "Sign up with a throwaway account (no email verification)");
  await page.getByRole("link", { name: "Use Restaurant" }).click().catch(async () => {
    await page.goto(`${APP}/signup?next=${encodeURIComponent("/sites/new")}`);
  });
  await page.waitForURL(/\/signup/);
  await page.locator("#email").waitFor();
  await pause(800);
  await typeSlow(page, "#email", email);
  await typeSlow(page, "#password", "demo-pass-2026");
  await pause(600);
  await page.getByRole("button", { name: "Create account" }).click();

  // Pick a template and a title.
  await page.waitForURL(/\/sites\/new/);
  await setCaption(page, "4 / 8", "Pick a template and a site title");
  await pause(1500);
  await page.locator("label", { hasText: "Restaurant" }).first().click();
  await pause(900);
  await typeSlow(page, "#title", siteTitle);
  await page.fill("#slug", "");
  await typeSlow(page, "#slug", slug);
  await page.getByText("Available").waitFor({ timeout: 15_000 }).catch(() => {});
  await pause(1600);
  await page.getByRole("button", { name: "Continue to payment" }).click();

  // Stripe Checkout.
  const paidAt = await payWithTestCard(page, { step: "5 / 8", text: "Pay with Stripe test card 4242 4242 4242 4242" });

  // Provisioning.
  await setCaption(page, "6 / 8", "Payment received; the worker is provisioning the WordPress site…");
  await waitForStatus(page, "Live");
  timings.liveSeconds = Math.round((Date.now() - paidAt) / 1000);
  await setCaption(page, "6 / 8", `Site live in ${timings.liveSeconds} s after payment`);
  await pause(3500);
  await openSite(page, "6 / 8", `Site live in ${timings.liveSeconds} s: the Restaurant template, ready to edit`);
  await pause(2000);
  await page.mouse.wheel(0, 500);
  await pause(2500);

  // Cancel the plan.
  await page.goto(`${APP}/dashboard`, { waitUntil: "load" });
  await setCaption(page, "7 / 8", "Cancel plan → licence inactive, site archived");
  await pause(2000);
  await page.getByRole("button", { name: "Cancel plan" }).click();
  await page.waitForURL(/plan=cancelled/, { timeout: 30_000 });
  await waitForStatus(page, "Archived");
  await pause(3000);
  await openSite(page, "7 / 8", "The archived site is offline for visitors");
  await pause(3500);

  // Renew.
  await page.goto(`${APP}/dashboard`, { waitUntil: "load" });
  await setCaption(page, "8 / 8", "Renew with the same test card");
  await pause(1800);
  await page.getByRole("button", { name: "Renew" }).click();
  const renewedAt = await payWithTestCard(page, { step: "8 / 8", text: "Renew: pay again with test card 4242" });
  await setCaption(page, "8 / 8", "Renewed; the worker restores the site…");
  await waitForStatus(page, "Live");
  timings.renewSeconds = Math.round((Date.now() - renewedAt) / 1000);
  await setCaption(page, "8 / 8", `Renew → site back online in ${timings.renewSeconds} s`);
  await pause(3000);
  await openSite(page, "8 / 8", "Renew → the same site is back online");
  await pause(3000);

  const video = page.video();
  await context.close();
  await browser.close();
  const raw = await video.path();
  await rename(raw, path.join(OUT, "appshelf-demo.webm"));
  for (const f of await readdir(OUT)) if (f.endsWith(".webm") && f !== "appshelf-demo.webm") await rm(path.join(OUT, f));
  await writeFile(path.join(OUT, "timings.json"), JSON.stringify({ ...timings, slug }, null, 2));
  console.log(`video: ${path.join(OUT, "appshelf-demo.webm")}`, timings);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
