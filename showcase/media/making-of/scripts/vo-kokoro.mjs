// Voice-over and word timings from a local Kokoro-FastAPI server in one pass.
// Stands in for `generate-audio-assets.mjs vo` + `align-voiceover.mjs` (which need
// Gemini TTS and ElevenLabs alignment): /dev/captioned_speech returns the audio and
// per-word timestamps together, so no separate forced alignment is needed.
//
// Writes assets/audio/vo/<scene>.wav (lines joined with GAP s of silence, 24 kHz mono)
// and data/vo-lines.json in the shape build-timeline.mjs reads.
// Each line is cached in data/.tts-cache/ by a hash of (voice, speed, text).
// Usage: node scripts/vo-kokoro.mjs [--force]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = JSON.parse(readFileSync(join(root, "data/script.json"), "utf8"));
const cfg = { url: "http://127.0.0.1:8880", model: "kokoro", voice: "af_heart", speed: 1.0, ...(script.voice.local || {}) };
const force = process.argv.includes("--force");
const GAP = 0.3; // silence between lines inside one scene file
const SR = 24000;
const cacheDir = join(root, "data/.tts-cache");
const voDir = join(root, "assets/audio/vo");
mkdirSync(cacheDir, { recursive: true });
mkdirSync(voDir, { recursive: true });

const spoken = (l) => l.say || l.en;
const key = (text) => createHash("sha1").update(JSON.stringify([cfg.model, cfg.voice, cfg.speed, text])).digest("hex").slice(0, 16);

async function synth(text) {
  const base = join(cacheDir, key(text));
  if (!force && existsSync(`${base}.json`) && existsSync(`${base}.wav`)) return { wav: `${base}.wav`, ts: JSON.parse(readFileSync(`${base}.json`, "utf8")) };
  const res = await fetch(`${cfg.url}/dev/captioned_speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: cfg.model, input: text, voice: cfg.voice, speed: cfg.speed, response_format: "wav", stream: false, return_timestamps: true }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const raw = `${base}.raw.wav`;
  writeFileSync(raw, Buffer.from(body.audio, "base64"));
  // the server streams a header with unknown sizes; let ffmpeg rewrite a clean PCM file
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", `${base}.wav`]);
  const ts = body.timestamps.filter((w) => /[\p{L}\p{N}]/u.test(w.word)).map((w) => ({ t: w.word, s: w.start_time, e: w.end_time }));
  writeFileSync(`${base}.json`, JSON.stringify(ts));
  return { wav: `${base}.wav`, ts };
}

const seconds = (wav) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav], { encoding: "utf8" }).trim());

// synthesise every line, two requests at a time (a CPU server is slow)
const jobs = script.scenes.flatMap((s) => s.lines.map((l) => spoken(l)));
const done = new Map();
const queue = [...new Set(jobs)];
await Promise.all(
  Array.from({ length: 2 }, async () => {
    while (queue.length) {
      const text = queue.shift();
      done.set(text, await synth(text));
      console.log(`tts ok: ${text}`);
    }
  }),
);

const result = {};
for (const s of script.scenes) {
  let offset = 0;
  const parts = [];
  const lines = s.lines.map((l, i) => {
    const { wav, ts } = done.get(spoken(l));
    const len = seconds(wav);
    const words = ts.map((w) => ({ t: w.t, s: +(offset + w.s).toFixed(3), e: +(offset + w.e).toFixed(3) }));
    parts.push(wav);
    const line = { start: words[0].s, end: words[words.length - 1].e, words };
    offset += len + (i < s.lines.length - 1 ? GAP : 0);
    return line;
  });
  // join the line files with GAP s of silence between them
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  parts.forEach((p) => args.push("-i", p));
  const chain = parts.map((_, i) => (i < parts.length - 1 ? `[${i}:a]apad=pad_dur=${GAP}[p${i}]` : `[${i}:a]anull[p${i}]`));
  const graph = `${chain.join(";")};${parts.map((_, i) => `[p${i}]`).join("")}concat=n=${parts.length}:v=0:a=1[out]`;
  args.push("-filter_complex", graph, "-map", "[out]", "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", join(voDir, `${s.id}.wav`));
  execFileSync("ffmpeg", args);
  result[s.id] = { speechStart: lines[0].start, speechEnd: lines[lines.length - 1].end, lines };
}
writeFileSync(join(root, "data/vo-lines.json"), JSON.stringify(result, null, 1));
for (const [id, v] of Object.entries(result)) console.log(id.padEnd(14), v.speechEnd.toFixed(2), v.lines.map((l) => `${l.start.toFixed(2)}-${l.end.toFixed(2)} [${l.words.map((w) => w.t).join(" ")}]`).join(" | "));
