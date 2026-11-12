# Demo video library

A copy of the `--from-browser` capture library from the `ak-motion-video` skill,
so the demo video builds from this repository alone. Copied on 2026-11-12 from
skill version 1.8.0 (with fit-to-voice beats, `highlight()` and `press()`).
Do not edit these files here; change the skill and copy them again.

| File | Role |
|---|---|
| `browser/capture-lib.mjs` | Drives the app with Playwright: cursor, click ripples, page wipes, a timecode strip in every frame, beats that fit their voice line, `fast()` for dead time, `highlight()` (a marker sweep after a visual-only press) and zooms, spotlights, callouts and timers. Writes `raw/recording.webm` and `data/capture.json`. |
| `browser/tts-local.mjs` | Cached narration from a local OpenAI-compatible TTS server (Kokoro). |
| `browser/browser-cut.py` | `cut` (re-times the recording in one pass, writes `assets/video/body.mp4`, `data/edit.json`, the voice track and subtitles, and fills `window.EDIT` in `index.html`), `mux` and `check`. |
| `recording/reclib.py` | Shared helpers for the Python steps (`browser-cut.py` imports it from `../recording/`). |
| `recording/mix.py` | Voice plus the ducked music bed into `assets/audio/mix.m4a`. |

[`../record-demo.mjs`](../record-demo.mjs) is the AppShelf flow built on it. The
project folder is [`showcase/media/edit`](../../showcase/media/edit): its
`data/browser.json` holds the lines, brand, edit and acceptance settings, and its
`index.html` is the composition with the AppShelf title and end cards.
