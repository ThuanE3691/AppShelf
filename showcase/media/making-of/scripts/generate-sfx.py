#!/usr/bin/env python3
"""Synthesises the ad's sound effects from code: no samples, no third-party audio.

    python generate-sfx.py --out assets/audio/sfx

Writes one short 48 kHz stereo MP3 per effect (key, tick, stamp, whoosh, pop),
which build-timeline.mjs places from data/cues.json. Dedicated to the public
domain (CC0 1.0), like the music bed; see ../CREDITS.md.
"""
import argparse
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 48_000
rng = np.random.default_rng(2611)


def t_axis(sec):
    return np.arange(int(sec * SR)) / SR


def key():
    """A soft keyboard click: a filtered noise burst with a tiny body tone."""
    t = t_axis(0.05)
    noise = rng.standard_normal(len(t))
    noise = np.convolve(noise, np.ones(6) / 6, mode="same")
    body = np.sin(2 * np.pi * 1900 * t) * 0.4
    return (noise * 0.6 + body) * np.exp(-t * 140)


def tick():
    """A bright check-mark blip: two quick sine partials."""
    t = t_axis(0.16)
    s = np.sin(2 * np.pi * 1320 * t) + 0.5 * np.sin(2 * np.pi * 1980 * t)
    return s * np.exp(-t * 32) * np.clip(t / 0.002, 0, 1)


def stamp():
    """A card landing: a low pitched-down thump plus a short click."""
    t = t_axis(0.3)
    f = 140 * np.exp(-t * 18) + 55
    thump = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14)
    click = rng.standard_normal(len(t)) * np.exp(-t * 220) * 0.35
    return thump + click


def whoosh():
    """A soft air sweep: band-limited noise whose brightness rises then falls."""
    t = t_axis(0.42)
    noise = rng.standard_normal(len(t))
    shape = np.sin(np.pi * t / t[-1]) ** 2
    out = np.zeros_like(noise)
    acc = 0.0
    for i, v in enumerate(noise):  # one-pole low-pass with a moving cutoff
        a = np.exp(-2 * np.pi * (300 + 3800 * shape[i]) / SR)
        acc = (1 - a) * v + a * acc
        out[i] = acc
    return out * shape * 2.2


def pop():
    """A rounded UI pop: a fast upward pitch blip."""
    t = t_axis(0.12)
    f = 420 + 900 * (1 - np.exp(-t * 60))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 30) * np.clip(t / 0.003, 0, 1)


EFFECTS = {"key": key, "tick": tick, "stamp": stamp, "whoosh": whoosh, "pop": pop}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, fn in EFFECTS.items():
            sig = fn()
            sig = sig / np.max(np.abs(sig)) * 0.8
            pcm = (np.stack([sig, sig]).T * 32767).astype("<i2")
            wav = Path(tmp) / f"{name}.wav"
            with wave.open(str(wav), "wb") as w:
                w.setnchannels(2)
                w.setsampwidth(2)
                w.setframerate(SR)
                w.writeframes(pcm.tobytes())
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-c:a", "libmp3lame", "-q:a", "2", str(out / f"{name}.mp3")], check=True)
            print(f"{name}: {len(sig) / SR:.2f} s")


if __name__ == "__main__":
    main()
