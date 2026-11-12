#!/usr/bin/env node
/**
 * Records and builds the AppShelf demo video: the real app (landing page,
 * templates, sign-up, Stripe test checkout, provisioning, cancel and renew),
 * narrated and cut to about 45 s. The capture and edit library is the copy in
 * scripts/video (see its README); the settings, lines and acceptance list are in
 * showcase/media/edit/data/browser.json, and the composition with the title and
 * end cards is showcase/media/edit/index.html.
 *
 * With the stack running (scripts/appshelf.ps1 up), Kokoro TTS on :8880, Google
 * Chrome, native ffmpeg and Python 3 on PATH:
 *
 *   npm i --no-save playwright-core@1.56.1
 *   node scripts/record-demo.mjs            record, then build
 *   node scripts/record-demo.mjs --build    rebuild from the last recording
 *
 * The build cuts the recording (browser-cut.py cut), renders the composition
 * (HyperFrames), mixes the voice with the CC0 music bed, muxes, runs the
 * acceptance check and, when it passes, copies the video and subtitles to
 * showcase/media. Each take signs up a fresh throwaway user; its site deletes
 * itself after 48 hours. APP_URL and TTS_URL override the config.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { createCapture } from "./video/browser/capture-lib.mjs";

const PROJECT = path.resolve("showcase/media/edit");
const LIB = path.resolve("scripts/video");
const MEDIA = path.resolve("showcase/media");
const config = JSON.parse(readFileSync(path.join(PROJECT, "data/browser.json"), "utf8"));
if (process.env.APP_URL) config.app.url = process.env.APP_URL;
if (process.env.TTS_URL) config.tts.url = process.env.TTS_URL;
const APP = config.app.url.replace(/\/$/, "");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function record() {
  const cap = await createCapture(config, { chromium, project: PROJECT });
  const run = Date.now().toString(36);
  const slug = `luna-bistro-${run}`;
  const page = await cap.open(APP);

  const label = (text) => page.locator("article .label", { hasText: text }).first();
  const badges = () => label(/^Licence /).locator("xpath=..");
  const waitForStatus = async (status) => {
    await label(new RegExp(`^${status}$`)).waitFor({ timeout: 120_000 });
    await cap.waitShown();
  };
  const backToDashboard = async () => {
    await cap.wipe("AppShelf dashboard");
    await cap.fast(() => page.goto(`${APP}/dashboard`, { waitUntil: "load" }));
    await cap.waitShown();
  };
  // Opens the site in the same tab, so the recording stays one video.
  const openSite = async () => {
    const link = page.locator("article a.text-link").first();
    await link.evaluate((a) => a.removeAttribute("target"));
    await cap.click(link, { dx: 0.35 });
    await cap.wipe("WordPress site");
    await cap.fast(() => page.waitForURL(/wp\./));
    await cap.waitShown();
  };
  // Pays on Stripe Checkout with the 4242 test card; `show` highlights the card.
  const payWithTestCard = async (paidMark, { show }) => {
    await cap.fast(() => page.locator("#cardNumber").waitFor({ timeout: 60_000 }));
    await cap.waitShown();
    // Checkout picks the currency from the IP address; show the USD price.
    const usd = page.locator("button", { hasText: "USD" }).first();
    if (await usd.isVisible().catch(() => false)) {
      await cap.click(usd);
      await cap.fast(() => pause(900));
    }
    const price = page.getByText(/^(US)?\$9\.00$/).first();
    if (show && (await price.isVisible().catch(() => false))) {
      await cap.highlight(price); // stays until the payment leaves the page
    }
    const card = page.locator("#cardNumber");
    const digits = { normalize: (v) => v.replace(/\D/g, ""), settle: 300 };
    if (show) await cap.focus([card, page.locator("#cardExpiry"), page.locator("#cardCvc")], 1.45);
    await cap.type(card, "4242424242424242", digits);
    if (show) {
      await cap.highlight(card);
      cap.callout("Stripe test card 4242 · 12/34 · 123", "tr");
    }
    await cap.type(page.locator("#cardExpiry"), "1234", digits);
    await cap.type(page.locator("#cardCvc"), "123", digits);
    if (show) {
      cap.unfocus();
      cap.uncallout();
    }
    await cap.fast(() => cap.type(page.locator("#billingName"), "Demo Buyer"));
    const country = page.locator("#billingCountry");
    if (await country.isVisible().catch(() => false)) {
      await cap.fast(async () => {
        await country.selectOption("US");
        const zip = page.locator("#billingPostalCode");
        if (await zip.isVisible().catch(() => false)) await zip.fill("94107");
      });
    }
    const at = cap.mark(paidMark);
    await cap.click(page.locator("button[type=submit]"));
    return at;
  };
  // Each beat starts with a clean frame: the last beat's zoom, spot and callout end here.
  const beat = async (id) => {
    await cap.beat(id);
    cap.clear();
  };

  await beat("intro");
  await cap.waitShown();
  const product = page.locator('article[aria-label$="product label"]');
  await cap.focus(product, 1.35);
  // The price box is signal yellow, where a yellow marker would not show: mark the
  // product name here and the price on Stripe Checkout.
  await cap.highlight(product.locator("h2").first());
  cap.callout("WordPress site · $9/month · Stripe test mode", "bl");

  await beat("templates");
  await cap.fast(async () => {
    await page.evaluate(() => document.querySelector("#templates")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    await pause(900);
  });
  await cap.spot(page.locator("#templates ul").first());
  for (const x of [300, 680, 1060]) await cap.moveTo(x, 420);

  await beat("signup");
  await cap.click(page.getByRole("link", { name: "Use Restaurant" }));
  await cap.fast(() => page.locator("#email").waitFor());
  await cap.waitShown();
  await cap.focus(page.locator("form").first(), 1.3);
  await cap.type(page.locator("#email"), `demo-${run}@example.com`);
  await cap.type(page.locator("#password"), "demo-pass-2026");
  await cap.click(page.getByRole("button", { name: "Create account" }));
  await cap.fast(() => page.waitForURL(/\/sites\/new/));

  await beat("newSite");
  await cap.waitShown();
  await cap.click(page.locator("label", { hasText: "Restaurant" }).first(), { dy: 0.3 });
  await cap.focus(page.locator("#title"), 1.3);
  await cap.type(page.locator("#title"), "Luna Bistro");
  await cap.fast(() => page.fill("#slug", ""));
  await cap.type(page.locator("#slug"), slug);
  const available = page.getByText("Available", { exact: true }).first();
  await cap.fast(() => available.waitFor({ timeout: 15_000 }));
  await cap.highlight(available);
  await cap.click(page.getByRole("button", { name: "Continue to payment" }));
  await cap.wipe("Stripe Checkout · test mode");

  await beat("pay");
  const paid = await payWithTestCard("paid", { show: true });

  // One beat spans the whole wait, so "live" always lands on the status flip.
  await beat("build");
  await cap.fast(() => page.waitForURL(/\/dashboard/, { timeout: 90_000 }));
  await cap.waitShown();
  cap.callout("Webhook → job → WordPress", "tr");
  await cap.spot(page.locator("article").first());
  await cap.moveTo(220, 520);
  await cap.fast(() => waitForStatus("Live"));
  const live = cap.mark("live");
  cap.timer("Since payment", "paid", "live");

  await beat("live");
  await cap.focus(badges(), 1.6);
  await cap.highlight(label(/^Live$/));
  cap.callout(`Site live in ${Math.round(live - paid)} s`, "tr");

  await beat("site");
  await openSite();
  await cap.focus(page.locator("h1, .wp-block-heading").first(), 1.2);
  await cap.moveTo(700, 300);
  await page.mouse.wheel(0, 380);

  await beat("cancel");
  await backToDashboard();
  await cap.click(page.getByRole("button", { name: "Cancel plan" }));
  await cap.fast(async () => {
    await page.waitForURL(/plan=cancelled/, { timeout: 30_000 });
    await waitForStatus("Archived");
  });
  await cap.focus(badges(), 1.6);
  await cap.highlight(label(/^Licence /));
  cap.callout("Licence inactive · site archived", "tr");

  await beat("archived");
  await openSite();
  await cap.highlight(page.getByText("archived or suspended").first());

  await beat("renew");
  await backToDashboard();
  await cap.click(page.getByRole("button", { name: "Renew" }));
  await cap.wipe("Stripe Checkout · test mode");
  // The second payment is a repeat: fast-forward the whole form.
  const renewed = await cap.fast(() => payWithTestCard("renewed", { show: false }));

  await beat("back");
  await cap.fast(async () => {
    await page.waitForURL(/\/dashboard/, { timeout: 90_000 });
    await waitForStatus("Live");
  });
  const back = cap.mark("back");
  await cap.focus(badges(), 1.6);
  await cap.highlight(label(/^Live$/));
  cap.callout(`Renewed · back online in ${Math.round(back - renewed)} s`, "tr");

  await beat("same");
  await openSite();
  await cap.moveTo(640, 420);

  await cap.finish({ slug });
}

const py = (script, ...args) =>
  execFileSync("python", ["-X", "utf8", path.join(LIB, script), PROJECT, ...args], { stdio: "inherit" });

function build() {
  py("browser/browser-cut.py", "cut");
  const { edit } = JSON.parse(readFileSync(path.join(PROJECT, "data/edit.json"), "utf8"));
  execFileSync("npx", ["--yes", "hyperframes@0.8.77", "render", "-o", "renders/edit.mp4"], { cwd: PROJECT, stdio: "inherit", shell: true });
  execFileSync("python", ["-I", path.join(MEDIA, "music/generate-bed.py"), "--seconds", String(Math.ceil(edit.duration) + 2),
    "--out", path.join(PROJECT, "assets/audio/bed.wav")], { stdio: "inherit" });
  py("recording/mix.py", "--music", path.join(PROJECT, "assets/audio/bed.wav"), "--music-db", "-22");
  py("browser/browser-cut.py", "mux");
  py("browser/browser-cut.py", "check", "--frames"); // throws on a miss: nothing is copied
  copyFileSync(path.join(PROJECT, "renders/final.mp4"), path.join(MEDIA, "appshelf-demo.mp4"));
  copyFileSync(path.join(PROJECT, "data/captions.vtt"), path.join(MEDIA, "appshelf-demo.vtt"));
  console.log(`video: ${path.join(MEDIA, "appshelf-demo.mp4")} (${edit.duration.toFixed(1)} s)`);
}

try {
  if (!process.argv.includes("--build")) await record();
  build();
} catch (error) {
  console.error(error);
  process.exit(1);
}
