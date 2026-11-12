"""Cut, mux and check a scripted browser capture (--from-browser).

  cut    raw/recording.webm + data/capture.json + data/browser.json
         -> assets/video/body.mp4   the recording re-timed in one pass (live moments 1x,
                                    dead time fast-forwarded), timecode strip cropped off,
                                    scaled to the edit size
            data/edit.json          captions, zooms, spotlights, markers, callouts, speed
                                    badges and timers in edit seconds and edit pixels, every
                                    beat's fit to its line, plus sync stats
            assets/audio/voice.wav  every beat line placed on the edit timeline, full length
            data/captions.vtt       subtitles
         and injects the edit into index.html when it has an /*EDIT:BEGIN*/ block.
  mux    renders/<edit>.mp4 + assets/audio/mix.m4a -> renders/final.mp4 (delivery size, faststart)
  check  the acceptance list in data/browser.json against renders/final.mp4; exit 1 on a miss.
         --frames also writes 10 fps strips around every highlight to renders/sync/ for a
         frame-by-frame sync look (contact sheets sample too sparsely to see a 1 s offset).

Usage: python -X utf8 browser-cut.py <project> [cut|mux|check] [--edit renders/edit.mp4] [--frames]

Between cut and mux: render the composition (HyperFrames) and run
recording/mix.py <project> [--music bed.wav] for assets/audio/mix.m4a.
"""
import argparse
import json
import math
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "recording"))
import reclib  # noqa: E402

EDIT_DEFAULTS = {
    "title": 2.0, "end": 3.0, "minHold": 1.4, "maxSpeed": 14.0, "minSpeed": 1.5, "voPad": 0.35,
    "maxLiveSpeed": 1.35, "calloutMax": 3.6, "spotMax": 6.0, "captionTail": 0.9, "zoomMargin": 0.6,
    "timerTail": 1.2, "voStart": 0.1, "captionBand": 96,
}
OUTPUT_DEFAULTS = {"width": 1920, "height": 1080, "fps": 30, "crf": 14,
                   "deliver": {"width": 1280, "height": 720, "crf": 23, "audioKbps": 128}}
WRAP = 1048576  # 20-bit centisecond counter


def merged(cfg, key, defaults):
    out = {**defaults, **(cfg.get(key) or {})}
    if key == "output":
        out["deliver"] = {**defaults["deliver"], **((cfg.get(key) or {}).get("deliver") or {})}
    return out


# ---------- timecode ----------

def decode_frames(raw, width, tc, frame_rows=4):
    """Decodes the strip of each frame (rows of gray bytes, frame_rows high) into (frame index, centiseconds).

    A bar reads as 1 when the median of a few samples is bright, 0 when dark; a
    mid-grey bar (a frame caught mid-update) or a bad nibble checksum drops the frame.
    """
    size = width * frame_rows
    out = []
    for k in range(len(raw) // size):
        f = raw[k * size:(k + 1) * size]
        code, ok = 0, True
        for i in range(tc["bits"]):
            x = tc["x"] + i * tc["barWidth"] + tc["barWidth"] // 2
            px = sorted(f[row * width + x + dx] for row in range(frame_rows) for dx in range(-8, 9, 4)
                        if 0 <= x + dx < width)
            m = px[len(px) // 2]
            if 70 < m < 185:
                ok = False
                break
            if m >= 185:
                code |= 1 << i
        if not ok:
            continue
        cs = code & 0xFFFFF
        if sum((cs >> n) & 15 for n in range(0, 20, 4)) & 15 != code >> 20:
            continue
        out.append((k, cs))
    return out


def clock_points(frames, fps, tc_base):
    """(video seconds, script seconds) pairs, dropping misreads that run backwards or jump ahead."""
    pts, last_v, last_r = [], 0.0, -1.0
    for k, cs in frames:
        r = ((cs - tc_base + WRAP) % WRAP) / 100
        v = k / fps
        if r < last_r or (last_r >= 0 and r - last_r > v - last_v + 1):
            continue
        pts.append((v, r))
        last_v, last_r = v, r
    return pts


def video_time(pts):
    """v_of(r): the video time at which the page first shows script time r."""
    def v_of(r):
        if r >= pts[-1][1]:
            return pts[-1][0] + (r - pts[-1][1])
        lo, hi = 0, len(pts) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if pts[mid][1] >= r:
                hi = mid
            else:
                lo = mid + 1
        return pts[lo][0]
    return v_of


def read_clock(video, vp, tc, tc_base, fps):
    proc = subprocess.run([reclib.need("ffmpeg"), "-hide_banner", "-loglevel", "error", "-i", str(video), "-vf",
                           f"fps={fps},crop={vp['width']}:4:0:{vp['height'] - tc['height'] + 2},format=gray",
                           "-f", "rawvideo", "-"], capture_output=True)
    if proc.returncode != 0:
        raise reclib.StepError(f"timecode read failed: {proc.stderr.decode(errors='replace')[-400:]}")
    raw = proc.stdout
    frames = decode_frames(raw, vp["width"], tc)
    total = len(raw) // (vp["width"] * 4)
    pts = clock_points(frames, fps, tc_base)
    if len(pts) < max(30, total // 4):
        raise reclib.StepError(f"timecode strip unreadable ({len(pts)} of {total} frames); was the overlay mounted?")
    drift = (pts[-1][0] - pts[-1][1]) - (pts[0][0] - pts[0][1])
    return pts, {"frames": total, "decoded": len(pts), "drift": round(drift, 3)}


# ---------- edit plan ----------

def merge_intervals(ivs):
    out = []
    for a, b in sorted(ivs):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def beat_length(bt, e):
    """A beat lasts its line plus voPad; `target` (optional) sets it for a beat without a line."""
    if bt.get("target") is not None:
        return bt["target"]
    return bt["vo"] + e["voPad"] if bt.get("vo") else 0.0


def fit_speeds(N, F, D, e):
    """(live speed, dead-time speed) that bring N s of live moments and F s of dead time to D s.

    Dead time ramps first, up to maxSpeed. When the live moments alone run past the
    line, they play up to maxLiveSpeed (a slightly brisker cursor reads as natural; a
    fast-forwarded one does not); what still does not fit stays, and `check` reports it.
    """
    if D <= 0:
        return 1.0, e["maxSpeed"]
    dead = 1.0
    if F > 0:
        dead = e["maxSpeed"] if N >= D else min(e["maxSpeed"], max(1.0, F / (D - N)))
    live = 1.0
    rest = D - F / dead
    if N > 0 and N > rest + 1e-6:
        live = e["maxLiveSpeed"] if rest <= 0 else min(e["maxLiveSpeed"], max(1.0, N / rest))
    return live, dead


def plan(cap, e, out_w, out_h, crop):
    """Segments (recording time, speed), the edit data, and the voice cues."""
    beats, events, marks = cap["beats"], cap["events"], cap["marks"]
    if not beats:
        raise reclib.StepError("capture has no beats")
    segs = []

    def push(a, b, speed, kind="live"):
        if b - a > 0.01:
            segs.append({"a": a, "b": b, "speed": speed, "kind": kind})

    push(marks["trimStart"], beats[0]["start"], e["maxSpeed"], "fast")
    edit_t = e["title"] + max(0.0, beats[0]["start"] - marks["trimStart"]) / e["maxSpeed"]
    beat_edits = []
    for bt in beats:
        fast = merge_intervals([[max(a, bt["start"]), min(b, bt["end"])] for a, b in bt["fast"] if min(b, bt["end"]) > max(a, bt["start"])])
        F = sum(b - a for a, b in fast)
        N = bt["end"] - bt["start"] - F
        D = beat_length(bt, e)
        live, speed = fit_speeds(N, F, D, e)
        at, t = edit_t, bt["start"]
        for a, b in fast:
            push(t, a, live)
            push(a, b, speed, "fast")
            t = b
        push(t, bt["end"], live)
        edit_t += N / live + F / speed
        voiced = bool(bt.get("vo"))
        beat_edits.append({"id": bt["id"], "at": at, "until": edit_t, "line": bt["line"], "vo": bt["vo"], "file": bt["file"],
                           "target": D, "speed": speed, "live": live,
                           # seconds between the end of the line and the end of the beat (silence)
                           "tail": edit_t - (at + e["voStart"] + bt["vo"]) if voiced else None})
    body = edit_t - e["title"]
    body_end = e["title"] + body

    starts, acc = [], e["title"]
    for s in segs:
        starts.append(acc)
        acc += (s["b"] - s["a"]) / s["speed"]

    def m(r):
        for i in range(len(segs) - 1, -1, -1):
            s = segs[i]
            if r >= s["a"]:
                return starts[i] + (min(r, s["b"]) - s["a"]) / s["speed"]
        return e["title"]

    sx, sy = out_w / crop["w"], out_h / crop["h"]

    def px(x, y):
        return (x - crop["x"]) * sx, (y - crop["y"]) * sy

    # A highlight must not outlive the page it points at: cap holds at the next navigation (wipe).
    page_changes = sorted(m(ev["t"]) for ev in events if ev["type"] == "page")

    def page_cap(at):
        return next((p for p in page_changes if p > at + 0.05), body_end)

    r3 = reclib.r3
    zooms = []
    zs = [ev for ev in events if ev["type"] == "zoom"]
    for i, ev in enumerate(zs):
        if ev["z"] == 1:
            continue
        nxt = zs[i + 1] if i + 1 < len(zs) else None
        at = m(ev["t"])
        next_at = m(nxt["t"]) if nxt else body_end - e["zoomMargin"]
        next_in = next((x for x in zs[i + 1:] if x["z"] != 1), None)
        if nxt and nxt["z"] != 1:
            until = next_at
        else:
            until = min(max(next_at, at + e["minHold"]), m(next_in["t"]) - e["zoomMargin"] if next_in else body_end - e["zoomMargin"])
        until = min(until, page_cap(at))
        cx, cy = px(ev["cx"], ev["cy"])
        zooms.append({"at": r3(at), "until": r3(max(until, at + 0.3)), "z": ev["z"], "cx": round(cx), "cy": round(cy),
                      "release": not nxt or nxt["z"] == 1})

    def spans(open_type, close_types, max_len):
        out = []
        for i, ev in enumerate(events):
            if ev["type"] != open_type:
                continue
            close = next((x for x in events[i + 1:] if x["type"] in close_types), None)
            at = m(ev["t"])
            out.append({**ev, "at": at, "until": min(m(close["t"]) if close else body_end, at + max_len)})
        return out

    def beat_end(at):
        return next((b["until"] for b in beat_edits if b["at"] <= at + 1e-6 < b["until"]), body_end)

    # Markers live inside the spoken time: they end with their beat, the next page
    # change or unmark(), and never lengthen anything.
    markers = []
    for mk in spans("marker", ("unmark",), math.inf):
        until = min(mk["until"], page_cap(mk["at"]), beat_end(mk["at"]))
        if until - mk["at"] < 0.3:
            continue
        x, y = px(mk["x"], mk["y"])
        markers.append({"at": r3(mk["at"]), "until": r3(until), "x": round(x), "y": round(y), "w": round(mk["w"] * sx), "h": round(mk["h"] * sy)})

    spot_list = spans("spot", ("spot", "unspot"), e["spotMax"])
    spots = []
    for i, s in enumerate(spot_list):
        nxt = spot_list[i + 1]["at"] if i + 1 < len(spot_list) else body_end
        # Extend to minHold first (fast-forwarding can squeeze a highlight to nothing), then
        # cap at the next spot and page change; drop only what still cannot be seen.
        until = min(max(s["until"], s["at"] + e["minHold"]), nxt, page_cap(s["at"]))
        if until - s["at"] < 0.3:
            continue
        x, y = px(s["x"], s["y"])
        spots.append({"at": r3(s["at"]), "until": r3(until), "x": round(x), "y": round(y), "w": round(s["w"] * sx), "h": round(s["h"] * sy)})
    callouts = []
    for c in spans("callout", ("callout", "uncallout"), e["calloutMax"]):
        until = min(max(c["until"], c["at"] + e["minHold"]), page_cap(c["at"]))
        if until - c["at"] >= 0.3:
            callouts.append({"at": r3(c["at"]), "until": r3(until), "text": c["text"], "pos": c["pos"]})
    speeds = []
    for i, s in enumerate(segs):
        ln = (s["b"] - s["a"]) / s["speed"]
        if s.get("kind", "fast") == "fast" and s["speed"] >= e["minSpeed"] and ln >= 0.4:
            speeds.append({"at": r3(starts[i]), "until": r3(starts[i] + ln), "speed": round(s["speed"])})
    timers = []
    for tm in cap.get("timers", []):
        f, t = tm["from"], tm["to"]
        keys = [[r3(m(f)), 0]]
        keys += [[r3(m(s["a"])), r3(s["a"] - f)] for s in segs if f < s["a"] < t]
        keys.append([r3(m(t)), r3(t - f)])
        timers.append({"at": r3(m(f)), "until": r3(m(t) + e["timerTail"]), "label": tm["label"], "keys": keys})
    vs = e["voStart"]
    captions = [{"at": r3(b["at"] + vs),
                 "until": r3(min(beat_edits[i + 1]["at"] if i + 1 < len(beat_edits) else body_end, b["at"] + vs + b["vo"] + e["captionTail"])),
                 "text": b["line"]} for i, b in enumerate(beat_edits) if b["line"]]
    cues = [{"at": b["at"] + vs, "file": b["file"], "seconds": b["vo"], "text": b["line"]} for b in beat_edits if b["file"]]
    if cap.get("endLine"):
        el = cap["endLine"]
        cues.append({"at": body_end + 0.35, "file": el["file"], "seconds": el["seconds"], "text": el["text"]})
    # Clicks and presses in edit px, so check can tell whether the subtitle band hides one.
    clicks = [{"at": r3(m(ev["t"])), "x": round(px(ev["x"], ev["y"])[0]), "y": round(px(ev["x"], ev["y"])[1])}
              for ev in events if ev["type"] == "click"]
    edit = {"title": e["title"], "body": r3(body), "end": e["end"], "duration": r3(e["title"] + body + e["end"]),
            "size": [out_w, out_h], "captionBand": e["captionBand"], "clicks": clicks,
            "captions": captions, "zooms": zooms, "spots": spots, "markers": markers, "callouts": callouts, "speeds": speeds,
            "timers": timers,
            "beats": [{k: (r3(v) if isinstance(v, float) else v) for k, v in b.items()
                       if k in ("id", "at", "until", "target", "vo", "tail", "speed", "live")} for b in beat_edits]}
    return segs, edit, cues


def setpts_graph(segs, v_of, crop, out_w, out_h, fps, f=lambda x: f"{x:.4f}"):
    """One piecewise-linear setpts over the whole stream, one fps pass, exact final length.

    Per-segment trim/setpts/fps rounds each piece to whole frames and the error adds
    up (about 0.7 s over 60 pieces); contiguous segments make a single pass possible.
    """
    knots, o = [], 0.0
    for sg in segs:
        knots.append((v_of(sg["a"]), o))
        o += (sg["b"] - sg["a"]) / sg["speed"]
    knots.append((max(v_of(segs[-1]["b"]), knots[-1][0] + 0.04), o))
    expr = f"{f(knots[-1][1])}+(T-{f(knots[-1][0])})"
    for i in range(len(knots) - 2, -1, -1):
        (kv, ko), (nv, no) = knots[i], knots[i + 1]
        if nv - kv < 1e-3:
            continue  # no video for this stretch: fps repeats the previous frame
        expr = f"if(lt(T,{f(nv)}),{f(ko)}+(T-{f(kv)})*{(no - ko) / (nv - kv):.5f},{expr})"
    graph = (f"[0:v]trim=start={f(knots[0][0])}:end={f(knots[-1][0])},setpts='({expr})/TB',fps={fps},"
             f"tpad=stop_mode=clone:stop_duration=1,trim=duration={f(o)},format=yuv420p,"
             f"crop={crop['w']}:{crop['h']}:{crop['x']}:{crop['y']},scale={out_w}:{out_h}:flags=lanczos,setsar=1[out]")
    return graph, o


def crop_for(vp, tc, out_w, out_h):
    """Largest box above the strip with the output's aspect ratio, centred horizontally."""
    h = vp["height"] - tc["height"]
    w = min(vp["width"], round(h * out_w / out_h))
    h = min(h, round(w * out_h / out_w))
    return {"x": (vp["width"] - w) // 2, "y": 0, "w": w - (w % 2), "h": h - (h % 2)}


def vtt_time(s):
    ms = round(s * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}"


def inject(html, edit, brand):
    if "/*EDIT:BEGIN*/" not in html:
        return None
    html = re.sub(r"/\*EDIT:BEGIN\*/[\s\S]*?/\*EDIT:END\*/",
                  lambda _: f"/*EDIT:BEGIN*/window.EDIT={json.dumps(edit, ensure_ascii=False)};/*EDIT:END*/", html)
    tokens = "".join(f"--{k}:{v};" for k, v in (brand or {}).items() if isinstance(v, str) and not k.endswith("Css") and k != "overlayFont")
    html = re.sub(r"/\*BRAND:BEGIN\*/[\s\S]*?/\*BRAND:END\*/", lambda _: f"/*BRAND:BEGIN*/:root{{{tokens}}}/*BRAND:END*/", html)
    html = re.sub(r'(data-composition-id="main"[^>]*?data-duration=")[\d.]+', rf"\g<1>{edit['duration']}", html)
    html = re.sub(r'(id="rec"[^>]*?data-start=")[\d.]+(" data-duration=")[\d.]+', rf"\g<1>{edit['title']}\g<2>{edit['body']}", html)
    return html


def voice_track(root, cues, total):
    out = root / "assets/audio/voice.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not cues:
        reclib.ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{total:.3f}", str(out)])
        return out
    inputs = []
    for c in cues:
        inputs += ["-i", c["file"]]
    n = len(cues)
    graph = ";".join(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={round(c['at'] * 1000)}:all=1[c{i}]"
                     for i, c in enumerate(cues))
    graph += f";{''.join(f'[c{i}]' for i in range(n))}amix=inputs={n}:normalize=0,apad,atrim=0:{total:.3f}[out]"
    reclib.ffmpeg([*inputs, "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_s16le", str(out)])
    return out


def cmd_cut(root, cfg):
    cap = reclib.read_json(root / "data/capture.json")
    e = merged(cfg, "edit", EDIT_DEFAULTS)
    out = merged(cfg, "output", OUTPUT_DEFAULTS)
    vp, tc = cap["viewport"], cap["timecode"]
    crop = crop_for(vp, tc, out["width"], out["height"])
    pts, sync = read_clock(root / "raw/recording.webm", vp, tc, cap["marks"]["tcBase"], out["fps"])
    segs, edit, cues = plan(cap, e, out["width"], out["height"], crop)
    lost = segs[-1]["b"] - pts[-1][1]
    if lost > 0.1:
        print(f"warning: the video stops {lost:.2f} s before the last beat ends; its tail is a frozen frame. "
              "Keep filming after the last action (capture-lib finish() holds 1.2 s).")
    graph, body_len = setpts_graph(segs, video_time(pts), crop, out["width"], out["height"], out["fps"])
    work = root / "builds"
    work.mkdir(exist_ok=True)
    (work / "body.filter").write_text(graph, encoding="utf-8")
    body = root / "assets/video/body.mp4"
    body.parent.mkdir(parents=True, exist_ok=True)
    reclib.ffmpeg(["-i", str(root / "raw/recording.webm"), reclib.filter_script_option(), str(work / "body.filter"),
                   "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", str(out["crf"]),
                   # a keyframe every second: the composition seeks the body, and sparse keyframes freeze frames
                   "-g", str(out["fps"]), "-keyint_min", str(out["fps"]), "-pix_fmt", "yuv420p", "-an", str(body)])
    got = reclib.duration(body)
    sync["bodyPlanned"], sync["bodyRendered"] = reclib.r3(body_len), reclib.r3(got)
    edit["sync"] = sync
    edit["cards"] = cfg.get("cards")
    reclib.write_json(root / "data/edit.json", {"edit": edit, "segs": segs, "crop": crop})
    voice_track(root, cues, edit["duration"])
    (root / "data/captions.vtt").write_text("WEBVTT\n\n" + "\n".join(
        f"{i + 1}\n{vtt_time(c['at'])} --> {vtt_time(c['at'] + c['seconds'] + 0.2)}\n{c['text']}\n" for i, c in enumerate(cues)),
        encoding="utf-8", newline="\n")
    page = root / "index.html"
    if page.is_file():
        html = inject(page.read_text(encoding="utf-8"), edit, cfg.get("brand"))
        if html is not None:
            page.write_text(html, encoding="utf-8", newline="\n")
    print(f"timecode: {sync['decoded']}/{sync['frames']} frames read, clock drift {sync['drift']:+.2f} s")
    print(f"body: planned {body_len:.3f} s, rendered {got:.3f} s; edit {edit['duration']:.2f} s "
          f"({len(edit['zooms'])} zooms, {len(edit['spots'])} spots, {len(edit['markers'])} markers, "
          f"{len(edit['callouts'])} callouts, {len(edit['speeds'])} speed badges)")
    for b in edit["beats"]:
        tail = "" if b["tail"] is None else f", {b['tail']:+.2f} s after its line"
        print(f"  {b['id']:<12} {b['at']:7.2f}-{b['until']:6.2f}  {b['until'] - b['at']:5.2f} s "
              f"(fit {b['target']:.2f}{tail}; ramp {b['speed']:.1f}x, live {b['live']:.2f}x)")
    if abs(got - body_len) > 1.5 / out["fps"]:
        raise reclib.StepError(f"body is {got:.3f} s, planned {body_len:.3f} s")


def cmd_mux(root, cfg, edit_path):
    d = merged(cfg, "output", OUTPUT_DEFAULTS)["deliver"]
    src = root / (edit_path or "renders/edit.mp4")
    mix = root / "assets/audio/mix.m4a"
    for p in (src, mix):
        if not p.is_file():
            raise reclib.StepError(f"missing {p}")
    final = root / "renders/final.mp4"
    reclib.ffmpeg(["-i", str(src), "-i", str(mix), "-map", "0:v", "-map", "1:a",
                   "-vf", f"scale={d['width']}:{d['height']}:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", str(d["crf"]),
                   "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", f"{d['audioKbps']}k", "-movflags", "+faststart", "-shortest", str(final)])
    print(f"final -> {final} ({reclib.duration(final):.2f} s, {final.stat().st_size / 1e6:.1f} MB)")


def probe_stream(path):
    out = reclib.run([reclib.need("ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate",
                      "-of", "json", str(path)], capture=True)
    s = json.loads(out)["streams"][0]
    num, den = s["r_frame_rate"].split("/")
    return s["width"], s["height"], float(num) / float(den)


def cam_at(edit, t):
    """(scale, x, y) of the composition's camera at edit second t, as edit-shell.html sets it.

    Zooms centre their target in the frame above the subtitle band and clamp to the
    frame; this uses the settled position, not the 0.3-0.7 s move into it.
    """
    w, h = edit.get("size", (1920, 1080))
    band = edit.get("captionBand", 0)
    for z in reversed(edit.get("zooms", [])):
        if z["at"] <= t < z["until"] + (0.55 if z.get("release") else 0):
            s = z["z"]
            return (s, min(0, max(w - w * s, w / 2 - z["cx"] * s)), min(0, max(h - h * s, (h - band) / 2 - z["cy"] * s)))
    return 1.0, 0.0, 0.0


def hidden_clicks(edit):
    """Clicks and presses that land under the subtitle band (while a subtitle shows) or off frame."""
    w, h = edit.get("size", (1920, 1080))
    band = edit.get("captionBand", 0)
    out = []
    for c in edit.get("clicks", []):
        s, ox, oy = cam_at(edit, c["at"])
        x, y = ox + c["x"] * s, oy + c["y"] * s
        caption = any(k["at"] <= c["at"] < k["until"] for k in edit.get("captions", []))
        if not (0 <= x < w and 0 <= y < h) or (caption and y > h - band):
            out.append(f"{c['at']:.1f} s")
    return out


def edit_rows(edit, acc):
    """Acceptance rows read from the edit plan alone: beat fit, marker count, pace."""
    rows = []

    def row(name, ok, detail):
        rows.append((name, ok, detail))

    max_tail = acc.get("maxTail", 0.5)
    beats = edit.get("beats", [])
    # A voiced beat must outlast its line (else the next line talks over it) and end
    # within maxTail of it (else the viewer waits in silence); a silent one hits its target.
    long = [f"{b['id']} {b['tail']:+.2f} s" for b in beats if b.get("tail") is not None and b["tail"] > max_tail]
    cut = [f"{b['id']} {b['tail']:+.2f} s" for b in beats if b.get("tail") is not None and b["tail"] < -0.05]
    short = [b["id"] for b in beats if b.get("tail") is None and b["until"] - b["at"] < b["target"] - 0.25]
    bad = long + cut + short
    row("beats", not bad, f"every beat ends within {max_tail} s of its line" if not bad else
        "; ".join(filter(None, [long and f"silence after the line: {', '.join(long)}",
                                cut and f"line cut off: {', '.join(cut)}", short and f"short of target: {', '.join(short)}"])))
    if "minMarkers" in acc:
        n = len(edit.get("markers", []))
        row("markers", n >= acc["minMarkers"], f"{n} marker sweeps (want {acc['minMarkers']}+)")
    if "clicks" in edit:
        hid = hidden_clicks(edit)
        row("clicks", not hid, f"{len(edit['clicks'])} clicks and presses in view, none under the subtitles" if not hid else
            f"click hidden by the subtitles or off frame at {', '.join(hid)}")
    stalls = [b["id"] for b in beats if b["speed"] == 1 and b["until"] - b["at"] > b["target"] + 2]
    row("pace", not stalls, "no long 1x waits" if not stalls else f"long 1x stretch in: {', '.join(stalls)}")
    return rows


def cmd_check(root, cfg, frames):
    acc = cfg.get("accept") or {}
    d = merged(cfg, "output", OUTPUT_DEFAULTS)["deliver"]
    final = root / "renders/final.mp4"
    if not final.is_file():
        raise reclib.StepError(f"missing {final}; run mux first")
    edit = reclib.read_json(root / "data/edit.json")["edit"]
    dur, mb = reclib.duration(final), final.stat().st_size / 1e6
    w, h, fps = probe_stream(final)
    log = reclib.ffmpeg_stderr(["-i", str(final), "-af", "ebur128=peak=true", "-f", "null", "-"])
    tail = log[log.rfind("Summary"):]
    lufs = float(re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", tail).group(1))
    peak = float(re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", tail).group(1))
    sync = edit.get("sync", {})
    rows = []

    def row(name, ok, detail):
        rows.append((name, ok, detail))

    lo, hi = acc.get("minSeconds", 0), acc.get("maxSeconds", math.inf)
    row("length", lo <= dur <= hi, f"{dur:.2f} s (want {lo}-{hi})")
    row("size", mb <= acc.get("maxMB", math.inf), f"{mb:.1f} MB (max {acc.get('maxMB', '-')})")
    row("frame", (w, h) == (d["width"], d["height"]), f"{w}x{h} @ {fps:.2f} fps")
    lr = acc.get("lufs", [-20, -12])
    row("loudness", lr[0] <= lufs <= lr[1] and peak <= acc.get("maxPeak", -1.0), f"{lufs:.1f} LUFS, peak {peak:.1f} dBFS")
    tol = acc.get("syncFrames", 1) / (fps or 30)
    gap = abs(sync.get("bodyRendered", 0) - sync.get("bodyPlanned", 0))
    row("sync", gap <= tol and sync.get("decoded", 0) >= 0.8 * sync.get("frames", 1),
        f"body off by {gap * 1000:.0f} ms, {sync.get('decoded')}/{sync.get('frames')} timecodes read, clock drift {sync.get('drift')} s")
    rows += edit_rows(edit, acc)
    for name, ok, detail in rows:
        print(f"{'ok' if ok else 'FAIL':<4} {name:<9} {detail}")
    if frames:
        out = root / "renders/sync"
        out.mkdir(parents=True, exist_ok=True)
        marks = sorted({x["at"] for k in ("zooms", "spots", "markers", "callouts") for x in edit.get(k, [])})
        for t in marks:
            reclib.ffmpeg(["-ss", f"{max(0, t - 0.5):.3f}", "-t", "1.0", "-i", str(final),
                           "-vf", "fps=10,scale=384:-2,tile=5x2:padding=4", "-frames:v", "1", str(out / f"at-{t:07.3f}.jpg")])
        print(f"sync strips -> {out} ({len(marks)} highlights, 10 fps from 0.5 s before each)")
    return 0 if all(ok for _, ok, _ in rows) else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("project")
    ap.add_argument("step", nargs="?", default="cut", choices=("cut", "mux", "check"))
    ap.add_argument("--edit", help="mux: the rendered composition, relative to the project (default renders/edit.mp4)")
    ap.add_argument("--frames", action="store_true", help="check: write 10 fps strips around each highlight")
    a = ap.parse_args()
    root = reclib.project_dir(a.project)
    cfg = reclib.read_json(root / "data/browser.json")
    if a.step == "cut":
        return cmd_cut(root, cfg)
    if a.step == "mux":
        return cmd_mux(root, cfg, a.edit)
    return cmd_check(root, cfg, a.frames)


if __name__ == "__main__":
    reclib.main_guard(main)
