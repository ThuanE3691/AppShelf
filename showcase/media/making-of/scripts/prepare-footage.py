#!/usr/bin/env python3
"""Cuts the two footage clips the ad plays from the AppShelf demo take.

    python prepare-footage.py --raw <recording.webm> --demo <final demo .mp4> --demo-in 20.5

- assets/footage/raw-ff.mp4: the whole raw recording fast-forwarded to scene 4's
  length, timecode strip cropped off (scene 4, the browser window).
- assets/footage/strip.mp4: only the bottom timecode strip of the same frames,
  scaled up with nearest-neighbour so the bars stay crisp (scene 4, the loupe).
- assets/footage/demo-cut.mp4: scene 6's length of the finished demo from --demo-in
  seconds (Stripe card through the LIVE badge), silent.

Scene lengths come from data/timeline.json. Prints the speed-up and the demo's
length for the speed badge (s04) and the player clock (s06).
"""
import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/footage"


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def size(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
    w, h = out.stdout.strip().split(",")[:2]
    return int(w), int(h)


def ff(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, help="raw recording.webm (timecode strip in the bottom rows)")
    ap.add_argument("--demo", required=True, help="the finished demo mp4")
    ap.add_argument("--demo-in", type=float, required=True, help="where scene 6's clip starts in the demo, seconds")
    ap.add_argument("--strip", type=int, default=8, help="timecode strip height in raw pixels")
    args = ap.parse_args()

    tl = json.loads((ROOT / "data/timeline.json").read_text(encoding="utf8"))
    s04 = tl["scenes"]["s04-capture"]
    s06 = tl["scenes"]["s06-result"]
    len4 = s04["end"] - s04["start"] + 0.1
    len6 = s06["end"] - s06["start"] + 0.1
    OUT.mkdir(parents=True, exist_ok=True)

    raw_len = duration(args.raw)
    w, h = size(args.raw)
    speed = raw_len / len4
    common = ["-an", "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    ff("-i", args.raw, "-vf", f"crop={w}:{h - args.strip}:0:0,setpts=PTS/{speed:.6f},fps=30,scale=1112:-2:flags=lanczos", "-t", f"{len4:.3f}", *common, str(OUT / "raw-ff.mp4"))
    ff("-i", args.raw, "-vf", f"crop={w}:{args.strip}:0:{h - args.strip},setpts=PTS/{speed:.6f},fps=30,scale=1640:76:flags=neighbor", "-t", f"{len4:.3f}", *common, str(OUT / "strip.mp4"))

    demo_len = duration(args.demo)
    ff("-ss", f"{args.demo_in:.3f}", "-i", args.demo, "-t", f"{len6:.3f}", "-vf", "fps=30,scale=1920:1080:flags=lanczos", *common, str(OUT / "demo-cut.mp4"))

    print(f"raw {raw_len:.2f} s at {w}x{h} -> {len4:.2f} s, speed-up {speed:.1f}x (s04 badge)")
    print(f"demo {demo_len:.2f} s; clip {args.demo_in:.2f}-{args.demo_in + len6:.2f} s (s06 DEMO_LEN / CLIP_IN)")


if __name__ == "__main__":
    main()
