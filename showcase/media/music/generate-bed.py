#!/usr/bin/env python3
"""Synthesises the demo video's background music: an original, upbeat bed.

Everything is generated from code (sine, saw and noise oscillators with simple
envelopes and filters), so there is no sampled or third-party material. The
output is dedicated to the public domain (CC0 1.0); see ../CREDITS.md.

    python generate-bed.py --seconds 70 --out bed.wav

112 BPM, C major, a I-V-vi-IV loop: soft kick, off-beat hats, a light clap on
2 and 4, an eighth-note bass, a side-chained pad and a sixteenth-note pluck.
Writes 48 kHz 16-bit stereo; loudness and ducking are set later in the mix.
"""
import argparse
import wave

import numpy as np

SR = 48_000
BPM = 112
BEAT = 60 / BPM
BAR = 4 * BEAT
# C - G - Am - F, as MIDI notes (root, chord tones)
CHORDS = [(48, [60, 64, 67, 72]), (43, [59, 62, 67, 71]), (45, [60, 64, 69, 72]), (41, [60, 65, 69, 72])]
rng = np.random.default_rng(1124)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def one_pole_lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):  # short buffers only (one note at a time)
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def env(n, attack, release, sustain=1.0):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    r = np.clip((n / SR - t) / max(release, 1e-4), 0, 1)
    return a * r * sustain


def add(buf, start, sig, pan=0.0):
    i = int(start * SR)
    if i >= buf.shape[1]:
        return
    sig = sig[: buf.shape[1] - i]
    left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[0, i : i + len(sig)] += sig * left
    buf[1, i : i + len(sig)] += sig * right


def kick():
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    f = 45 + 75 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * 0.9


def hat():
    n = int(0.05 * SR)
    noise = np.diff(rng.standard_normal(n + 1))
    return noise * np.exp(-np.arange(n) / SR * 90) * 0.06


def clap():
    n = int(0.14 * SR)
    noise = rng.standard_normal(n)
    band = noise - one_pole_lowpass(noise, 900)
    band = one_pole_lowpass(band, 4000)
    return band * np.exp(-np.arange(n) / SR * 26) * 0.18


def bass(m, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * hz(m) * t) + 0.25 * np.sin(4 * np.pi * hz(m) * t)
    return s * env(n, 0.005, 0.06) * np.exp(-t * 3) * 0.32


def saw(f, n, detune):
    t = np.arange(n) / SR
    ph = (f * (1 + detune) * t) % 1.0
    return 2 * ph - 1


def pad(notes, dur):
    n = int(dur * SR)
    s = np.zeros(n)
    for m in notes[:3]:
        for d in (-0.004, 0.0, 0.005):
            s += saw(hz(m), n, d)
    s = one_pole_lowpass(s / 9, 1400)
    return s * env(n, 0.35, 0.5) * 0.22


def pluck(m, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m + 12)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    return s * np.exp(-t * 11) * env(n, 0.002, 0.03) * 0.09


def build(seconds):
    total = int((seconds + 1.0) * SR)
    mix = np.zeros((2, total))
    duck = np.ones(total)
    bars = int(np.ceil(seconds / BAR)) + 1
    for b in range(bars):
        t0 = b * BAR
        root, tones = CHORDS[b % 4]
        intro = b == 0  # first bar: pad and pluck only, the groove enters on bar 2
        add(mix, t0, pad(tones, BAR + 0.4), pan=0.0)
        for i in range(16):
            arp = [0, 1, 2, 3, 2, 1, 2, 3][i % 8]
            add(mix, t0 + i * BEAT / 4, pluck(tones[arp], BEAT / 2), pan=0.45 if i % 2 else -0.45)
        if intro:
            continue
        for k in range(4):
            tk = t0 + k * BEAT
            add(mix, tk, kick())
            j = int(tk * SR)
            pump = 1 - 0.55 * np.exp(-np.arange(int(BEAT * SR)) / SR * 9)
            duck[j : j + len(pump)] = np.minimum(duck[j : j + len(pump)], pump[: max(0, total - j)])
            add(mix, tk + BEAT / 2, hat(), pan=0.3)
            if k in (1, 3):
                add(mix, tk, clap(), pan=-0.1)
        for e in range(8):
            add(mix, t0 + e * BEAT / 2, bass(root if e % 4 != 3 else root + 7, BEAT / 2 * 0.9))
    # The pad and plucks breathe with the kick (side-chain feel).
    mix *= duck
    mix = np.tanh(mix * 1.4) / np.tanh(1.4)
    mix /= np.max(np.abs(mix)) / 0.89
    return mix[:, : int(seconds * SR)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    pcm = (build(args.seconds).T * 32767).astype("<i2")
    with wave.open(args.out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    main()
