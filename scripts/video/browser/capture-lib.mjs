// Scripted browser capture for --from-browser: drives a real web app with
// Playwright, records it, and logs everything the edit needs (beats, dead time,
// zooms, spotlights, callouts, timers) against a timecode burned into every frame.
//
// The project's flow script imports this file by path and passes its own
// Playwright `chromium` (the skill folder has no node_modules):
//
//   import { chromium } from "playwright-core";
//   import { createCapture } from "<skill>/assets/templates/browser/capture-lib.mjs";
//   const cap = await createCapture(config, { chromium, project: "." });
//   const page = await cap.open(config.app.url);
//   await cap.beat("intro"); await cap.highlight(page.locator("h1")); ...
//   await cap.finish();          // raw/recording.webm + data/capture.json
//
// config is the project's data/browser.json (data/browser.example.json documents it).
// Then `python -X utf8 <skill>/assets/templates/browser/browser-cut.py <project>`.
// references/browser-capture.md explains every rule this file encodes.
import { realpathSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { localTts } from "./tts-local.mjs";

export const DEFAULTS = {
  viewport: { width: 1280, height: 720 },
  timecode: { height: 8, bits: 24, x: 16, barWidth: 48 },
  brand: { ink: "#121212", paper: "#ffffff", accent: "#ffd400", overlayFontCss: "", overlayFont: "ui-monospace, Consolas, monospace" },
  wipes: [],
  edit: { voPad: 0.35, afterFast: 0.6, afterMark: 0.9 },
  browser: { channel: "chrome", locale: "en-US" },
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs in every document (and every iframe; it bails out there). Draws a cursor
 * with click ripples, a page wipe naming the destination, and the timecode strip.
 * Everything lives in shadow-DOM custom elements that are re-mounted when the
 * page or its hydration removes them.
 */
function overlay(o) {
  if (window.top !== window.self || location.protocol === "about:") return;
  const state = { x: o.cursor.x, y: o.cursor.y, label: "", covered: o.coverOnLoad };
  const fixed = (el, rules) =>
    el.setAttribute("style", ["all:initial", "display:block", "position:fixed", "margin:0", "transform:none", ...rules]
      .map((d) => `${d} !important`).join(";"));
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
  const B = o.brand;
  const cursor = () => mount("mv-cursor", (host) => {
    host.shadowRoot.innerHTML = `<style>
        svg{position:absolute;left:0;top:0;filter:drop-shadow(1px 2px 2px rgba(0,0,0,.35));transform-origin:3px 3px;transition:transform .09s}
        .down svg{transform:scale(.86)}
        .ring{position:absolute;left:-18px;top:-18px;width:36px;height:36px;border:3px solid ${B.accent};border-radius:50%;box-sizing:border-box;opacity:0}
      </style><div class="c"><div class="ring"></div><svg width="26" height="32" viewBox="0 0 26 32">
        <path d="M3 2 L3 26 L9.5 20 L14 30 L18.5 28 L14 18.5 L23 18.5 Z" fill="${B.ink}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></div>`;
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
    c.querySelector(".ring").animate([{ opacity: 0.95, transform: "scale(.4)" }, { opacity: 0, transform: "scale(1.9)" }],
      { duration: 520, easing: "cubic-bezier(.2,.7,.3,1)" });
  }, { capture: true });
  addEventListener("mouseup", () => cursor()?.shadowRoot.querySelector(".c")?.classList.remove("down"), { capture: true });
  // A press for emphasis on text that is not a button: the same ripple and squeeze,
  // drawn only. No mouse event reaches the page, so nothing on it can react.
  window.__mvPress = () => {
    const c = cursor()?.shadowRoot.querySelector(".c");
    if (!c) return;
    c.classList.add("down");
    c.querySelector(".ring").animate([{ opacity: 0.95, transform: "scale(.4)" }, { opacity: 0, transform: "scale(1.9)" }],
      { duration: 520, easing: "cubic-bezier(.2,.7,.3,1)" });
    setTimeout(() => c.classList.remove("down"), 110);
  };

  const slab = () => {
    const host = mount("mv-wipe", (h) => {
      h.shadowRoot.innerHTML = `<style>
          .s{position:absolute;inset:0;background:${B.accent};color:${B.ink};display:flex;align-items:center;padding-left:96px;
            font:700 44px/1 ${B.overlayFont};letter-spacing:-.01em;transform:translateX(-100%)}
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
    for (const w of o.wipes) if (new RegExp(w.match).test(location.href)) return w.label;
    return location.hostname;
  };
  // Without a label the slab comes in blank and names the destination on arrival
  // (labelFor of the new URL), since the destination is unknown before the click.
  window.__mvWipe = (label) => {
    state.label = label ?? "";
    state.covered = true;
    window.__mvShown = false;
    return slab()?.animate([{ transform: "translateX(-100%)" }, { transform: "translateX(0)" }],
      { duration: 340, easing: "cubic-bezier(.7,0,.84,0)", fill: "forwards" }).finished;
  };
  window.__mvReveal = () => {
    state.covered = false;
    const s = slab();
    const done = s?.animate([{ transform: "translateX(0)" }, { transform: "translateX(100%)" }],
      { duration: 420, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }).finished;
    return Promise.resolve(done).then(() => { window.__mvShown = true; });
  };

  // Timecode: wall-clock centiseconds (20 bits) + a 4-bit nibble sum, as bars.
  const T = o.tc;
  const tc = () => mount("mv-timecode", (h) => {
    fixed(h, ["left:0", "bottom:0", "width:100%", `height:${T.height}px`, "z-index:2147483647", "pointer-events:none", "background:#000"]);
    h.shadowRoot.innerHTML = Array.from({ length: T.bits }, (_, i) =>
      `<i style="position:absolute;top:0;bottom:0;left:${T.x + i * T.barWidth}px;width:${T.barWidth}px;background:#000"></i>`).join("");
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

  state.label = labelFor();
  const boot = () => {
    if (o.brand.overlayFontCss && !document.getElementById("__mv_fonts") && document.documentElement) {
      const link = document.createElement("link");
      link.id = "__mv_fonts";
      link.rel = "stylesheet";
      link.href = o.brand.overlayFontCss;
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
  // document.documentElement can still be null when an init script runs.
  if (document.documentElement) boot();
  else new MutationObserver((_, ob) => { if (document.documentElement) { ob.disconnect(); boot(); } })
    .observe(document, { childList: true });
  window.__mvCursor?.().then((c) => place(c.x, c.y)).catch(() => {});
  const keep = new MutationObserver(() => {
    if (!document.querySelector("mv-cursor")) place(state.x, state.y);
    if (!document.querySelector("mv-timecode")) tc();
    if (state.covered && !document.querySelector("mv-wipe")) boot();
  });
  const watch = () => document.documentElement && keep.observe(document.documentElement, { childList: true });
  if (document.documentElement) watch();
  else document.addEventListener("DOMContentLoaded", watch, { once: true });
  // Client-side routing (pushState, popstate) keeps the document, so no new load
  // reveals the page: name the destination and reveal once the DOM is quiet.
  const onRoute = () => {
    if (!state.covered || !document.documentElement) return;
    if (!state.label) state.label = labelFor();
    slab();
    const t0 = Date.now();
    let timer;
    const done = () => { quiet.disconnect(); window.__mvReveal(); };
    const quiet = new MutationObserver(() => {
      if (Date.now() - t0 > 3000) return;
      clearTimeout(timer);
      timer = setTimeout(done, 250);
    });
    quiet.observe(document.documentElement, { childList: true, subtree: true });
    timer = setTimeout(done, 250);
  };
  for (const k of ["pushState", "replaceState"]) {
    const orig = history[k];
    history[k] = function (...args) {
      const r = orig.apply(this, args);
      setTimeout(onRoute, 0);
      return r;
    };
  }
  addEventListener("popstate", () => setTimeout(onRoute, 0));

  window.__mvShown = !state.covered;
  if (state.covered) {
    const reveal = () => setTimeout(() => window.__mvReveal(), 300);
    if (document.readyState === "complete") reveal();
    else addEventListener("load", reveal, { once: true });
  }
}

/**
 * config: the project's data/browser.json (see data/browser.example.json).
 * opts: { chromium, project = ".", tts } — tts overrides the local TTS client
 * (any { speak(text) -> {file, seconds}, prepare(lines) }), or false for no voice.
 */
export async function createCapture(config, { chromium, project = ".", tts } = {}) {
  if (!chromium) throw new Error("pass { chromium } from the project's playwright or playwright-core");
  const cfg = {
    ...DEFAULTS, ...config,
    viewport: { ...DEFAULTS.viewport, ...config.viewport },
    timecode: { ...DEFAULTS.timecode, ...config.timecode },
    brand: { ...DEFAULTS.brand, ...config.brand },
    edit: { ...DEFAULTS.edit, ...config.edit },
    browser: { ...DEFAULTS.browser, ...config.browser },
  };
  const beatsById = Object.fromEntries((cfg.beats ?? []).map((b) => [b.id, b]));
  const voice = tts === false || !cfg.tts ? null : tts ?? localTts(cfg.tts);
  // Docker and some tools cannot use Windows 8.3 short paths (C:\Users\ABCDEF~1).
  await mkdir(path.join(project, "raw"), { recursive: true });
  await mkdir(path.join(project, "data"), { recursive: true });
  const root = realpathSync.native(project);
  const rawDir = path.join(root, "raw");

  let browser, context, page, t0 = 0, cur = null;
  let cursorAt = { x: cfg.viewport.width / 2, y: cfg.viewport.height / 2 };
  const beats = [], events = [], marks = {}, timers = [];
  const now = () => (Date.now() - t0) / 1000;

  const cap = {
    get page() { return page; },
    now,
    config: cfg,

    /** Synthesises every beat line up front (lines are cached), launches the browser and opens url. */
    async open(url, { coverOnLoad = true } = {}) {
      if (voice) await voice.prepare([...(cfg.beats ?? []).map((b) => b.line), cfg.endLine]);
      for (const f of await readdir(rawDir)) if (f.endsWith(".webm")) await rm(path.join(rawDir, f));
      browser = await chromium.launch(cfg.browser.channel ? { channel: cfg.browser.channel } : {});
      context = await browser.newContext({
        viewport: cfg.viewport,
        // The screencast is captured at CSS-pixel size whatever the scale factor:
        // record at the viewport size and scale up in the cut.
        deviceScaleFactor: 1,
        locale: cfg.browser.locale,
        bypassCSP: true,
        recordVideo: { dir: rawDir, size: cfg.viewport },
      });
      await context.exposeFunction("__mvCursor", () => cursorAt);
      const opts = { brand: cfg.brand, wipes: cfg.wipes, tc: cfg.timecode, cursor: cursorAt, coverOnLoad };
      await context.addInitScript(`(${overlay.toString()})(${JSON.stringify(opts)});`);
      page = await context.newPage();
      t0 = Date.now();
      marks.tcBase = Math.floor(t0 / 10) % 1048576;
      page.on("dialog", async (d) => { await pause(500); await d.accept(); });
      // A highlight must end when its page goes away; the cut caps holds at these.
      page.on("framenavigated", (f) => { if (f === page.mainFrame() && t0) events.push({ type: "page", t: now() }); });
      await page.goto(url, { waitUntil: "load" });
      marks.trimStart = Math.max(0, now() - 0.1);
      return page;
    },

    /**
     * Starts a beat: one narration line. The beat lasts its line plus edit.voPad in
     * the edit; `target` (optional, seconds) sets the length of a beat without a line.
     */
    async beat(id, override = {}) {
      await cap.closeBeat();
      const b = { ...beatsById[id], ...override };
      if (!b.line && b.target == null) throw new Error(`unknown beat ${id}: add it to config.beats`);
      const clip = voice && b.line ? await voice.speak(b.line) : { file: null, seconds: 0 };
      cur = { id, line: b.line ?? "", target: b.target ?? null, vo: clip.seconds, file: clip.file, start: now(), fast: [] };
    },

    /** The beat's length in the edit: its target when set, else its line plus voPad. */
    beatLength(b = cur) {
      return b.target ?? (b.vo ? b.vo + cfg.edit.voPad : 0);
    },

    /**
     * Ends the beat. The edit can only shorten a beat (by fast-forwarding dead time),
     * so a beat that ran shorter than its line waits here, still: the voice is still
     * speaking, and the next action starts when it stops. No cursor drift.
     */
    async closeBeat() {
      if (!cur) return;
      // The result of a fast-forwarded action (typed text, a loaded page) needs a
      // moment at 1x, or it is on screen for a frame: hold afterFast after the last one.
      // A marker swept in at the very end of a beat (after a wait) would end with it
      // unseen: hold afterMark after the last one. Both holds are still frames.
      const lastFast = cur.fast.at(-1)?.[1];
      const settle = Math.max(lastFast == null ? 0 : cfg.edit.afterFast - (now() - lastFast),
        cur.lastMark == null ? 0 : cfg.edit.afterMark - (now() - cur.lastMark));
      const short = Math.max(cap.beatLength() - (now() - cur.start), settle);
      if (short > 0) await pause(short * 1000);
      cur.end = now();
      beats.push(cur);
      cur = null;
    },

    /** Marks dead time (typing, loads, waits) for the edit to fast-forward. */
    async fast(fn) {
      const a = now();
      try {
        return await fn();
      } finally {
        cur?.fast.push([a, now()]);
      }
    },

    /** Eased, slightly curved cursor path, like a hand on a mouse. */
    async moveTo(x, y, slow = 1) {
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
    },

    async box(locator) {
      await locator.scrollIntoViewIfNeeded();
      const b = await locator.boundingBox();
      if (!b) throw new Error("element has no box (hidden or detached)");
      return b;
    },

    /** Moves to the element and clicks it with a visible press (a real click). */
    async click(locator, { dx = 0.5, dy = 0.5 } = {}) {
      const b = await cap.box(locator);
      await cap.moveTo(b.x + b.width * dx, b.y + b.height * dy);
      await pause(120);
      await page.mouse.down();
      await pause(80);
      await page.mouse.up();
    },

    /**
     * Clicks and types (fast-forwarded), then reads the value back and retypes it
     * when the page swallowed keystrokes (third-party forms that re-render).
     * normalize maps both values before comparing (default: as is).
     */
    async type(locator, text, { delay = 45, normalize = (v) => v, settle = 0 } = {}) {
      await cap.click(locator, { dx: 0.3 });
      await cap.fast(() => page.keyboard.type(text, { delay }));
      if (settle) await cap.fast(() => pause(settle));
      for (let attempt = 0; attempt < 2; attempt++) {
        const value = await locator.inputValue().catch(() => null);
        if (value === null || normalize(value) === normalize(text)) return;
        await cap.fast(async () => {
          await locator.fill("");
          await locator.click();
          await page.keyboard.type(text, { delay: 30 });
        });
      }
      throw new Error(`field kept a wrong value after retyping: ${await locator.inputValue()}`);
    },

    /**
     * Moves to the element and shows a press for emphasis, without clicking: the
     * ripple is drawn by the overlay and no mouse event is dispatched, so links,
     * buttons and handlers under the cursor never fire. dx/dy pick the point.
     */
    async press(target, { dx = 0.5, dy = 0.5 } = {}) {
      const b = await cap.textBox(target);
      await cap.moveTo(b.x + b.width * dx, b.y + b.height * dy);
      await pause(90);
      await page.evaluate(() => window.__mvPress?.()).catch(() => {});
      await pause(120);
      return b;
    },

    /**
     * Emphasises text: the cursor arrives with a press (unless press: false), then a
     * marker in the accent colour sweeps left to right behind the text. The marker is
     * drawn by the composition in recording space, so zooms keep it on the text; it
     * lasts until unmark(), clear(), the next page change or the end of the beat,
     * whichever comes first, and never adds length to the beat.
     */
    async highlight(target, { press = true, dx = 0.12, dy = 0.5 } = {}) {
      const b = press ? await cap.press(target, { dx, dy }) : await cap.textBox(target);
      events.push({ type: "marker", t: now(), x: b.x, y: b.y, w: b.width, h: b.height });
      if (cur) cur.lastMark = now();
      return b;
    },
    unmark() { events.push({ type: "unmark", t: now() }); },

    /**
     * Tight box of an element's text in page CSS px (a Range over its contents), so a
     * marker hugs the words rather than a wide block; falls back to the element box.
     */
    async textBox(target) {
      const loc = [target].flat()[0];
      await loc.scrollIntoViewIfNeeded();
      const b = await loc.evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const t = r.getBoundingClientRect();
        return t.width > 0 && t.height > 0 ? { x: t.left, y: t.top, width: t.width, height: t.height } : null;
      }).catch(() => null);
      return b ?? cap.box(loc);
    },

    /** Covers the page with the wipe before a navigation (label defaults to the wipes table). */
    async wipe(label) {
      events.push({ type: "page", t: now() });
      await page.evaluate((l) => window.__mvWipe?.(l), label).catch(() => {});
    },

    /** Waits until the new document is revealed: "it happened" is not "it is visible". */
    async waitShown(timeout = 10_000) {
      const shown = await page.waitForFunction(() => window.__mvShown === true, null, { timeout }).then(() => true, () => false);
      if (!shown) {
        // Never leave the page covered: reveal it and say so, the take may need a look.
        console.warn(`waitShown: page not revealed after ${timeout} ms at ${page.url()}; forcing the reveal`);
        await page.evaluate(() => window.__mvReveal?.()).catch(() => {});
      }
    },

    /** Union box of a locator or an array of them, in page CSS px. */
    async boxAround(target) {
      const boxes = await Promise.all([target].flat().map((l) => cap.box(l)));
      const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
      const r = Math.max(...boxes.map((b) => b.x + b.width)), btm = Math.max(...boxes.map((b) => b.y + b.height));
      return { x, y, width: r - x, height: btm - y };
    },

    // Highlights are logged in page CSS px and recording seconds; the cut maps them
    // to edit pixels (crop + scale) and edit seconds.
    async focus(target, z = 1.4) {
      const b = await cap.boxAround(target);
      events.push({ type: "zoom", t: now(), z, cx: b.x + b.width / 2, cy: b.y + b.height / 2 });
    },
    unfocus() { events.push({ type: "zoom", t: now(), z: 1 }); },
    async spot(target) {
      const b = await cap.boxAround(target);
      events.push({ type: "spot", t: now(), x: b.x, y: b.y, w: b.width, h: b.height });
    },
    unspot() { events.push({ type: "unspot", t: now() }); },
    callout(text, pos = "tr") { events.push({ type: "callout", t: now(), text, pos }); },
    uncallout() { events.push({ type: "uncallout", t: now() }); },
    /** Clears every open highlight at once. */
    clear() { cap.unspot(); cap.uncallout(); cap.unfocus(); cap.unmark(); },

    /** Records a named moment (recording seconds); returns it. */
    mark(name) { marks[name] = now(); return marks[name]; },
    /** A running "N s" counter in real seconds between two marks, kept true while the edit fast-forwards. */
    timer(label, fromMark, toMark) { timers.push({ label, from: marks[fromMark], to: marks[toMark] }); },

    /** Closes the beat and the browser; writes raw/recording.webm and data/capture.json. */
    async finish(extra = {}) {
      await cap.closeBeat();
      // The screencast loses its last frames when the context closes: keep filming a
      // second past the last beat so its final action is on video.
      await pause(1200);
      marks.recEnd = now();
      const video = page.video();
      await context.close();
      await browser.close();
      const out = path.join(rawDir, "recording.webm");
      await rm(out, { force: true });
      await rename(await video.path(), out);
      const endClip = voice && cfg.endLine ? await voice.speak(cfg.endLine) : null;
      const data = {
        version: 1,
        viewport: cfg.viewport,
        timecode: cfg.timecode,
        marks,
        beats,
        events,
        timers,
        endLine: endClip ? { text: cfg.endLine, file: endClip.file, seconds: endClip.seconds } : null,
        ...extra,
      };
      await writeFile(path.join(root, "data", "capture.json"), JSON.stringify(data, null, 1));
      console.log(`recorded ${marks.recEnd.toFixed(1)} s, ${beats.length} beats, ${events.length} events`);
      return data;
    },
  };
  return cap;
}
