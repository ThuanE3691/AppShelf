# "Making of" ad credits

`appshelf-ad.mp4` is a 16:9 motion-graphic ad about how the AppShelf demo video
was made. Everything in it is listed here with its source and licence.

| Element | Source | Licence |
|---|---|---|
| Background music | Original. Synthesised from code by [`scripts/generate-bed.py`](scripts/generate-bed.py) (oscillators, noise and envelopes; no samples or third-party recordings), the same bed as the AppShelf demo video. | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), dedicated to the public domain by the author |
| Sound effects | Original. Synthesised from code by [`scripts/generate-sfx.py`](scripts/generate-sfx.py) (key clicks, ticks, stamps, whooshes, pops). | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Voice-over | Generated locally with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (voice `af_heart`) through [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) (`ghcr.io/remsky/kokoro-fastapi-cpu:v0.2.4`), by [`scripts/vo-kokoro.mjs`](scripts/vo-kokoro.mjs). The script is ours. | Model weights Apache-2.0; the generated audio is ours to use |
| Footage (scenes 4 and 6) | The raw browser recording and the finished AppShelf demo video, cut by [`scripts/prepare-footage.py`](scripts/prepare-footage.py) | Same as this repository; Stripe's Checkout page belongs to Stripe and is shown as used by the app in test mode |
| Motion graphics | Original HyperFrames composition: [`index.html`](index.html) and [`scenes/`](scenes/) | Same as this repository |
| Fonts | [Space Grotesk](https://github.com/floriankarsten/space-grotesk) and [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), from Google Fonts | SIL Open Font License 1.1 (`assets/fonts/OFL-*.txt`) |

## Rebuild

```bash
python scripts/generate-bed.py --seconds 66 --out assets/audio/music/bed.wav
python scripts/generate-sfx.py --out assets/audio/sfx
node scripts/vo-kokoro.mjs                       # needs Kokoro-FastAPI on 127.0.0.1:8880
node scripts/build-timeline.mjs                  # timing, captions, SFX, mix.m4a
python scripts/prepare-footage.py --raw <recording.webm> --demo <demo.mp4> --demo-in <s>
python <ak-motion-video>/scripts/assemble.py . --tag full
cd builds/full && npx --yes hyperframes@0.8.77 render -q high -f 30 --strict -o ../../renders/appshelf-ad.mp4
```
