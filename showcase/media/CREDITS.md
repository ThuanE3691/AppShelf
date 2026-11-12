# Demo video credits

`appshelf-demo.mp4` is a screen recording of the real AppShelf app (Stripe in
test mode), made with [`scripts/record-demo.mjs`](../../scripts/record-demo.mjs)
and the capture library in [`scripts/video`](../../scripts/video/README.md).
Everything in it is listed here with its source and licence.

| Element | Source | Licence |
|---|---|---|
| Background music | Original. Synthesised from code by [`music/generate-bed.py`](music/generate-bed.py) (oscillators, noise and envelopes; no samples or third-party recordings). | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), dedicated to the public domain by the author |
| Voice-over | Generated locally with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (voice `af_heart`) through [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) (`ghcr.io/remsky/kokoro-fastapi-cpu:v0.2.4`). The script is ours. | Model weights Apache-2.0; the generated audio is ours to use |
| Title and end cards, highlights | Original HyperFrames composition in [`edit/`](edit/index.html) | Same as this repository |
| Fonts | [Space Grotesk](https://github.com/floriankarsten/space-grotesk) and [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), from Google Fonts | SIL Open Font License 1.1 (`edit/assets/fonts/OFL-*.txt`) |
| Screens | The AppShelf web app, Stripe Checkout in test mode and the WordPress Multisite templates, recorded live | Stripe's Checkout page and marks belong to Stripe; shown as used by the app |
