// Builds the master timeline for the composition:
// - places every voice-over line on the music's beat grid (scene cuts land on beats),
// - times the Vietnamese captions against the spoken English words,
// - resolves SFX cues (word / beat / scene-relative / absolute),
// - renders the final audio mix (ducked music + VO + SFX, loudness-normalized) with ffmpeg,
// - injects the timing data into index.html and writes data/timeline.json.
// Usage: node scripts/build-timeline.mjs [--no-audio] [--dry] [--stems]
// Template from the motion-video skill: edit the block marked EDIT (grid sections, anchors, duration) per project.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    "Usage: node scripts/build-timeline.mjs [--no-audio] [--dry] [--stems]\n" +
      "  --no-audio  timing only; keep the existing mix and data/vo-envelope.json\n" +
      "  --dry       print the schedule only\n  --stems     also write the ducked-music and voice stems to the temp dir",
  );
  process.exit(0);
}
process.on("uncaughtException", (e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
// A missing input stops with one line naming the step that creates it.
const need = (p, hint) => {
  if (existsSync(p)) return p;
  console.error(`error: ${p} not found; ${hint}`);
  process.exit(1);
};
const example = (name) => `start from <skill>/assets/templates/data/${name}.example.json`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p, hint) => JSON.parse(readFileSync(need(join(root, p), hint), "utf8"));
const script = readJson("data/script.json", example("script"));
const vo = readJson("data/vo-lines.json", "run align-voiceover.mjs");
const noAudio = process.argv.includes("--no-audio");
const dry = process.argv.includes("--dry"); // print the schedule only
const stems = process.argv.includes("--stems"); // also write the ducked-music and voice stems to the temp dir
const cues = dry ? [] : readJson("data/cues.json", example("cues"));
const work = join(os.tmpdir(), `${basename(root)}-mix`);
mkdirSync(work, { recursive: true });

// ---------- EDIT per project: grid sections, duration and musical anchors ----------
// Music grid of bed.wav (scripts/generate-bed.py, 112 BPM, beat 0 at 0 s, groove from beat 4).
const arrangement = readJson("data/music-arrangement.json", `${example("music-arrangement")}, then edit data/music-arrangement.json`);
const BEAT0 = arrangement.beat0;
const BEAT = 60 / arrangement.bpm;
const beat = (n) => BEAT0 + BEAT * n;
const nextBeat = (t) => beat(Math.ceil((t - BEAT0) / BEAT - 1e-6));
const KICK = [[4, 112]]; // the groove plays from bar 2 to the end
const DROPS = [];
const OUTRO_BEAT = arrangement.fadeOut.beat; // beat reactions stop here
const DURATION = 58.2;
const FPS = 30;
const TEMPO = 1.0; // Kokoro's natural pace already fits the script windows
const CUT_AFTER = 0.12;
const VO_LEAD = 0.05;
const SEG_PRE = 0.08;
const SEG_POST = 0.15;
const MUSIC_DB = -10; // bed.wav measures about -10.7 LUFS; this sits it 5 dB under the voice after ducking
const FADE_OUT = 1.2;

// Scene cuts on beats (b = 0.5357 s), first words placed in each scene's script window.
const ANCHORS = {
  "s01-hook": { scene: 0, lines: [0.35, 2.4] },
  "s02-brief": { scene: beat(8), lines: [4.75, 7.95] },
  "s03-code": { scene: beat(21), lines: [11.65, 14.7] },
  "s04-capture": { scene: beat(36), lines: [19.75, 23.2] },
  "s05-cut": { scene: beat(53), lines: [28.75, 30.95, 33.25] },
  "s06-result": { scene: beat(70), lines: [38.15] },
  "s07-iterate": { scene: beat(84), lines: [45.4, 48.1] },
  "s08-end": { scene: beat(98), lines: [53.0, 54.75] },
};

const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

// ---------- END EDIT ----------

// ---------- 1. schedule voice lines ----------
const scenes = [];
let prevOff = 0;
let prevVoEnd = 0;
for (const s of script.scenes) {
  const a = ANCHORS[s.id] || {};
  const tempo = s.outro ? 1 : TEMPO;
  const src = vo[s.id].lines;
  // Segment bounds: pad each line, but never cross the midpoint of the gap to its neighbour.
  const segs = src.map((l, i) => {
    const prevMid = i ? (src[i - 1].end + l.start) / 2 : 0;
    const nextMid = i < src.length - 1 ? (l.end + src[i + 1].start) / 2 : Infinity;
    return { a: Math.max(0, l.start - SEG_PRE, prevMid), b: Math.min(l.end + SEG_POST, nextMid) };
  });
  const sceneAt = a.scene ?? nextBeat(prevOff + CUT_AFTER);
  if (sceneAt < prevVoEnd - 0.2) console.warn(`${s.id}: cut at ${sceneAt.toFixed(2)} clips the previous voice (${prevVoEnd.toFixed(2)})`);
  const lines = [];
  src.forEach((l, i) => {
    const seg = segs[i];
    const lead = (l.start - seg.a) / tempo;
    let place;
    if (a.lines?.[i] != null) place = a.lines[i] - lead;
    else if (i === 0) place = sceneAt + VO_LEAD;
    else place = lines[i - 1].place + (seg.a - segs[i - 1].a) / tempo; // keep the natural gap
    if (i > 0 && place < lines[i - 1].segEnd + 0.05) {
      console.warn(`${s.id} line ${i}: overlaps previous line, pushed later`);
      place = lines[i - 1].segEnd + 0.05;
    }
    const at = (x) => place + (x - seg.a) / tempo;
    lines.push({
      place,
      segEnd: place + (seg.b - seg.a) / tempo,
      seg,
      tempo,
      on: at(l.start),
      off: at(l.end),
      words: l.words.map((w) => [norm(w.t), round(at(w.s)), round(at(w.e))]),
      vi: s.lines[i].vi,
    });
  });
  prevVoEnd = lines[lines.length - 1].segEnd;
  prevOff = lines[lines.length - 1].off;
  scenes.push({ id: s.id, start: sceneAt, lines });
}
scenes.forEach((s, i) => (s.end = i < scenes.length - 1 ? scenes[i + 1].start : DURATION));
if (dry) {
  for (const s of scenes) {
    const b = ((s.start - BEAT0) / BEAT).toFixed(1);
    console.log(`${s.id.padEnd(18)} ${s.start.toFixed(2).padStart(7)} (b${b}) → ${s.end.toFixed(2).padStart(7)}  ` + s.lines.map((l) => `${l.on.toFixed(2)}–${l.off.toFixed(2)}`).join(" | "));
  }
  process.exit(0);
}
for (const s of scenes) {
  for (const l of s.lines) if (l.segEnd > s.end + 0.01) console.warn(`${s.id}: voice runs past its scene end (${l.segEnd.toFixed(2)} > ${s.end.toFixed(2)})`);
}

// ---------- 2. Vietnamese captions ----------
// Each VI word borrows the onset of the proportionally matching EN word; long lines are split at punctuation.
const MAX_CHUNK = 9;
const captions = [];
for (const s of scenes) {
  for (const l of s.lines) {
    const toks = l.vi.split(/\s+/).filter(Boolean);
    const en = l.words;
    const words = toks.map((t, i) => ({ t, s: en[Math.min(en.length - 1, Math.floor((i * en.length) / toks.length))][1] }));
    for (let i = 1; i < words.length; i++) if (words[i].s <= words[i - 1].s) words[i].s = round(words[i - 1].s + 0.07);
    let cur = [];
    const flush = () => cur.length && (captions.push({ scene: s.id, lineOff: l.off, words: cur }), (cur = []));
    words.forEach((w, i) => {
      cur.push(w);
      const left = words.length - i - 1;
      const punct = /[,.:;?!]$/.test(w.t);
      if (left === 0) return;
      if ((punct && cur.length >= 3 && left >= 2 && words.length > MAX_CHUNK) || cur.length >= MAX_CHUNK) flush();
    });
    flush();
  }
}
captions.forEach((c, i) => {
  c.start = round(c.words[0].s - 0.12);
  const next = captions[i + 1];
  const natural = next && next.lineOff === c.lineOff ? next.words[0].s - 0.12 : c.lineOff + 0.5;
  c.end = round(next ? Math.min(natural, next.words[0].s - 0.16) : natural);
});

// ---------- 3. SFX cues ----------
const wordTime = (sceneId, word, nth = 1) => {
  const s = scenes.find((x) => x.id === sceneId);
  if (!s) throw new Error(`cue: unknown scene ${sceneId}`);
  const hits = s.lines.flatMap((l) => l.words).filter((w) => w[0] === word);
  if (hits.length < nth) throw new Error(`cue: "${word}" #${nth} not found in ${sceneId}`);
  return hits[nth - 1][1];
};
const sfxEvents = cues.map((c) => {
  let t;
  if (c.word) t = wordTime(c.scene, c.word, c.nth);
  else if (c.beat != null) t = beat(c.beat);
  else if (c.abs != null) t = c.abs;
  else t = scenes.find((x) => x.id === c.scene).start + c.at;
  return { sfx: c.sfx, vol: c.vol ?? 0.5, t: Math.max(0, round(t + (c.offset || 0))) };
});

// ---------- 4. audio mix ----------
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-nostats", "-y", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 });
// ffmpeg writes its analysis reports (ebur128, loudnorm) to stderr.
const stderrOf = (args) => spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf8" }).stderr;
const loudness = (file) => {
  const log = stderrOf(["-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(log.slice(log.lastIndexOf("Summary")))[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(log.slice(log.lastIndexOf("Summary")))[1]);
  return { I, peak };
};
const gainFor = (file, target) => {
  const { I, peak } = loudness(file);
  return Math.min(target - I, -1 - peak); // dB, never push a peak above -1 dBFS
};

let env = [];
if (!noAudio) {
  const inputs = [need(join(root, arrangement.output), "run arrange-music.mjs")];
  const graph = [];
  const FMT = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  // one synthesised bed (scripts/generate-bed.py), no outro composition
  graph.push(`[0:a]${FMT},atrim=0:${DURATION},volume=${MUSIC_DB}dB[mus]`);

  // voice: one input per scene file, split into its line segments
  const voLabels = [];
  for (const s of scenes) {
    const file = need(join(root, `assets/audio/vo/${s.id}.wav`), "run generate-audio-assets.mjs vo");
    const idx = inputs.push(file) - 1;
    const g = gainFor(file, -16);
    const outs = s.lines.map((_, i) => `[v${idx}_${i}]`);
    graph.push(`[${idx}:a]${FMT},volume=${g.toFixed(2)}dB,asplit=${outs.length}${outs.join("")}`);
    s.lines.forEach((l, i) => {
      const len = (l.seg.b - l.seg.a) / l.tempo;
      const tempo = l.tempo !== 1 ? `,atempo=${l.tempo}` : "";
      const lbl = `[vl${idx}_${i}]`;
      graph.push(
        `[v${idx}_${i}]atrim=start=${l.seg.a.toFixed(4)}:end=${l.seg.b.toFixed(4)},asetpts=PTS-STARTPTS${tempo},` +
          `afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, len - 0.05).toFixed(4)}:d=0.05,adelay=delays=${Math.round(l.place * 1000)}:all=1${lbl}`,
      );
      voLabels.push(lbl);
    });
  }
  const voOuts = stems ? "[vobus][voside][voenv][vostem]" : "[vobus][voside][voenv]";
  graph.push(`${voLabels.join("")}amix=inputs=${voLabels.length}:normalize=0:dropout_transition=0,asplit=${stems ? 4 : 3}${voOuts}`);
  // moderate ducking: the music sits ~5 dB under speech and comes back to voice level in the gaps
  const duck = "sidechaincompress=threshold=0.03:ratio=3:attack=15:release=350:makeup=1";
  graph.push(stems ? `[mus][voside]${duck},asplit=2[musd][musstem]` : `[mus][voside]${duck}[musd]`);

  // sound effects: one input per distinct file
  const sfxLabels = [];
  const byFile = new Map();
  sfxEvents.forEach((e) => byFile.set(e.sfx, [...(byFile.get(e.sfx) || []), e]));
  for (const [id, evs] of byFile) {
    const file = need(join(root, `assets/audio/sfx/${id}.mp3`), "run generate-audio-assets.mjs sfx");
    const idx = inputs.push(file) - 1;
    const g = gainFor(file, -16);
    const outs = evs.map((_, i) => `[x${idx}_${i}]`);
    graph.push(`[${idx}:a]${FMT},volume=${g.toFixed(2)}dB,asplit=${outs.length}${outs.join("")}`);
    evs.forEach((e, i) => {
      const lbl = `[xl${idx}_${i}]`;
      graph.push(`[x${idx}_${i}]volume=${e.vol},adelay=delays=${Math.round(e.t * 1000)}:all=1${lbl}`);
      sfxLabels.push(lbl);
    });
  }
  graph.push(
    `[musd][vobus]${sfxLabels.join("")}amix=inputs=${2 + sfxLabels.length}:normalize=0:dropout_transition=0,` +
      `afade=t=out:st=${DURATION - FADE_OUT}:d=${FADE_OUT},atrim=0:${DURATION},apad=whole_dur=${DURATION}[out]`,
  );
  graph.push(`[voenv]pan=mono|c0=0.5*c0+0.5*c1,aresample=24000,apad=whole_dur=${DURATION},atrim=0:${DURATION}[env]`);

  const graphFile = join(work, "mix-graph.txt");
  writeFileSync(graphFile, graph.join(";\n"));
  writeFileSync(join(work, "mix-inputs.json"), JSON.stringify(inputs)); // lets the graph be re-run for stem checks
  const premix = join(work, "premix.wav");
  const envRaw = join(work, "vo-env.f32");
  // --stems writes the ducked music and the voice bus so scripts/measure-mix-balance.py can check the balance
  const stemOut = stems
    ? ["-map", "[musstem]", "-c:a", "pcm_s16le", join(work, "stem-music.wav"), "-map", "[vostem]", "-c:a", "pcm_s16le", join(work, "stem-voice.wav")]
    : [];
  ff([...inputs.flatMap((f) => ["-i", f]), "-/filter_complex", graphFile, "-map", "[out]", "-c:a", "pcm_s16le", premix, "-map", "[env]", "-f", "f32le", envRaw, ...stemOut]);
  if (stems) console.log(`stems -> ${join(work, "stem-music.wav")}, ${join(work, "stem-voice.wav")}`);

  // two-pass loudness normalization to -14 LUFS / -1.5 dBTP
  const LN = "loudnorm=I=-14:TP=-1.5:LRA=11";
  const m = JSON.parse(/\{[\s\S]*?\}/.exec(stderrOf(["-i", premix, "-af", `${LN}:print_format=json`, "-f", "null", "-"]).split("[Parsed_loudnorm")[1])[0]);
  const pass2 = `${LN}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const mixOut = join(root, "assets/audio/mix.m4a");
  ff(["-i", premix, "-af", pass2, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", mixOut]);
  console.log(`mix -> ${mixOut} (premix ${m.input_i} LUFS -> -14)`);

  // voice envelope at the video frame rate (drives the mascot mouth and the waveform)
  const buf = readFileSync(envRaw);
  const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const per = 24000 / FPS;
  const rms = [];
  for (let f = 0; f < DURATION * FPS; f++) {
    let sum = 0;
    for (let i = f * per; i < (f + 1) * per && i < samples.length; i++) sum += samples[i] * samples[i];
    rms.push(Math.sqrt(sum / per));
  }
  const sorted = rms.filter((x) => x > 0.005).sort((x, y) => x - y);
  const ref = sorted[Math.floor(sorted.length * 0.9)] || 1;
  env = rms.map((x) => round(Math.min(1, x / ref), 2));
  writeFileSync(join(root, "data/vo-envelope.json"), JSON.stringify(env));
} else {
  env = readJson("data/vo-envelope.json", "run build-timeline.mjs without --no-audio");
}

// ---------- 5. write timing + inject into the composition ----------
const timing = {
  duration: DURATION,
  fps: FPS,
  beat0: BEAT0,
  beatLen: round(BEAT, 6),
  kick: KICK,
  drops: DROPS,
  outroBeat: OUTRO_BEAT,
  scenes: Object.fromEntries(
    scenes.map((s) => [s.id, { start: round(s.start), end: round(s.end), lines: s.lines.map((l) => ({ on: round(l.on), off: round(l.off), words: l.words })) }]),
  ),
  captions: captions.map((c) => ({ start: c.start, end: c.end, words: c.words.map((w) => [w.t, w.s]) })),
  sfx: sfxEvents,
  env,
};
writeFileSync(join(root, "data/timeline.json"), JSON.stringify({ ...timing, env: undefined }, null, 1));

const htmlPath = join(root, "index.html");
let html = readFileSync(need(htmlPath, "start from <skill>/assets/templates/index-skeleton.html"), "utf8");
const block = `/*TIMING:BEGIN*/window.TIMING=${JSON.stringify(timing)};/*TIMING:END*/`;
if (!html.includes("/*TIMING:BEGIN*/")) throw new Error("index.html is missing the /*TIMING:BEGIN*/ marker");
html = html.replace(/\/\*TIMING:BEGIN\*\/[\s\S]*?\/\*TIMING:END\*\//, () => block);
// the studio may prepend data-hf-id attributes, so match id anywhere in the tag
html = html.replace(/(<div\b[^>]*?\bid="root"[^>]*?data-duration=")[\d.]+"/, `$1${DURATION}"`);
html = html.replace(/(<audio\b[^>]*?\bid="mix"[^>]*?data-duration=")[\d.]+"/, `$1${DURATION}"`);
writeFileSync(htmlPath, html);

for (const s of scenes) {
  console.log(
    `${s.id.padEnd(18)} ${s.start.toFixed(2).padStart(7)} → ${s.end.toFixed(2).padStart(7)}  ` +
      s.lines.map((l) => `${l.on.toFixed(2)}–${l.off.toFixed(2)}`).join(" | "),
  );
}
console.log(`captions ${captions.length}, sfx ${sfxEvents.length}, env frames ${env.length}`);
