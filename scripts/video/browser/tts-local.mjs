// Local text-to-speech through any OpenAI-compatible /v1/audio/speech server
// (Kokoro-FastAPI by default), cached on disk by a hash of (model, voice, speed,
// text) so a re-run only synthesises lines that changed.
//
//   docker run -d --name kokoro-tts -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:v0.2.4
//
// Used by the browser capture library (each beat needs its line's length while
// recording) and by generate-audio-assets.mjs --provider local. Keep numbers that
// change between takes (seconds, ids) out of the lines and put them in callouts,
// or every take misses the cache. A CPU server takes 15-40 s per line: call
// prepare() with every line first, it runs them a few at a time.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const TTS_DEFAULTS = { url: "http://localhost:8880", model: "kokoro", voice: "af_heart", speed: 1.0, format: "wav" };

/** Length in seconds of a PCM WAV buffer (walks the chunks; some servers write odd headers). */
export function wavSeconds(buf) {
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

/**
 * Returns speak(text) -> { file, seconds } and prepare(lines).
 * cfg: { url, model, voice, speed } (see TTS_DEFAULTS); cacheDir defaults to <tmp>/motion-video-tts.
 */
export function localTts(cfg = {}, cacheDir = path.join(os.tmpdir(), "motion-video-tts")) {
  const c = { ...TTS_DEFAULTS, ...cfg };
  const url = c.url.replace(/\/$/, "");
  const inflight = new Map();

  async function synth(text, file) {
    const res = await fetch(`${url}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: c.model, input: text, voice: c.voice, response_format: "wav", speed: c.speed, stream: false }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status} from ${url}: ${(await res.text()).slice(0, 300)}`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }

  async function speak(text) {
    const key = createHash("sha1").update(`${c.model}|${c.voice}|${c.speed}|${text}`).digest("hex").slice(0, 16);
    const file = path.join(cacheDir, `${key}.wav`);
    if (!existsSync(file)) {
      if (!inflight.has(file)) inflight.set(file, synth(text, file).finally(() => inflight.delete(file)));
      await inflight.get(file);
    }
    return { file, seconds: wavSeconds(await readFile(file)) };
  }

  /** Synthesises every line up front, `size` at a time, and reports progress. */
  async function prepare(lines, size = 2) {
    const queue = [...new Set(lines.filter(Boolean))];
    let done = 0;
    await Promise.all(Array.from({ length: size }, async () => {
      while (queue.length) {
        await speak(queue.shift());
        console.log(`tts ${++done}/${lines.length}`);
      }
    }));
  }

  return { speak, prepare, config: c };
}
