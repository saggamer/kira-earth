"""Voiceover for the tour video.

  python demo/voiceover.py tts            # ElevenLabs (key: $ELEVENLABS_API_KEY or backend/.secrets/elevenlabs.key)
  python demo/voiceover.py tts --say      # offline placeholder with macOS `say` (for timing tests)
  python demo/voiceover.py mix VIDEO STEPS.json OUT.mp4

`tts` writes demo/voice/<id>.mp3 and demo/voice/durations.json (the recorder uses these as minimum
step lengths so speech never overruns a step). `mix` places each clip at the start time the recorder
logged for its step, writes English subtitles (SRT, also embedded as a soft track) and muxes.
The API key is read from the environment or the git-ignored secrets file and never printed.
"""
from __future__ import annotations
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
VOICE = HERE / "voice"
NARRATION = json.loads((HERE / "narration.json").read_text())
VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")   # "George": warm, clear narrator (stock voice)
MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")


def api_key() -> str:
    key = os.getenv("ELEVENLABS_API_KEY")
    f = HERE.parent / "backend" / ".secrets" / "elevenlabs.key"
    if not key and f.exists():
        key = f.read_text().strip()
    if not key:
        sys.exit("No ElevenLabs key: set ELEVENLABS_API_KEY or save it in backend/.secrets/elevenlabs.key")
    return key


def duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def tts(offline: bool) -> None:
    VOICE.mkdir(exist_ok=True)
    key = None if offline else api_key()
    durations = {}
    for seg in NARRATION:
        out = VOICE / f"{seg['id']}.mp3"
        if offline:
            aiff = VOICE / f"{seg['id']}.aiff"
            subprocess.run(["say", "-r", "175", "-o", str(aiff), seg["text"]], check=True)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff), "-codec:a", "libmp3lame", "-q:a", "2", str(out)], check=True)
            aiff.unlink()
        else:
            body = json.dumps({"text": seg["text"], "model_id": MODEL_ID,
                               "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.15, "use_speaker_boost": True}}).encode()
            req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}?output_format=mp3_44100_128", body,
                                         {"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    out.write_bytes(r.read())
            except urllib.error.HTTPError as e:   # report status and reason, never the key
                sys.exit(f"ElevenLabs refused segment '{seg['id']}': HTTP {e.code} {e.read()[:300].decode(errors='replace')}")
        tagged = out.with_suffix(".tagged.mp3")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(out), "-c", "copy", "-metadata", f"comment=SI-generated audio: "
                        f"{'macOS say (placeholder)' if offline else f'ElevenLabs {VOICE_ID} {MODEL_ID}'}. See AI_USE.md.",
                        "-metadata", "title=Trend Detective narration (AI-generated voice)", str(tagged)], check=True)
        tagged.replace(out)
        durations[seg["id"]] = round(duration(out), 3)
        print(f"{seg['id']:13s} {durations[seg['id']]:5.1f}s")
    (VOICE / "durations.json").write_text(json.dumps({"source": "say" if offline else f"elevenlabs:{VOICE_ID}:{MODEL_ID}", "durations": durations}, indent=1))


def srt_time(t: float) -> str:
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}"


def mix(video: str, steps_file: str, out: str) -> None:
    steps = json.loads(Path(steps_file).read_text())
    durs = json.loads((VOICE / "durations.json").read_text())["durations"]
    inputs, filters, labels, srt = ["-i", video], [], [], []
    for i, seg in enumerate(NARRATION, start=1):
        start = steps[seg["id"]] + 0.35          # small lead-in after the step appears
        inputs += ["-i", str(VOICE / f"{seg['id']}.mp3")]
        ms = int(start * 1000)
        filters.append(f"[{i}:a]adelay={ms}|{ms},volume=1.0[a{i}]")
        labels.append(f"[a{i}]")
        # subtitles: split long lines into two cues at a sentence boundary
        words = seg["text"]
        srt.append((start, start + durs[seg["id"]], words))
    filters.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
    srt_path = Path(out).with_suffix(".srt")
    srt_path.write_text("\n".join(f"{n}\n{srt_time(a)} --> {srt_time(b)}\n{t}\n" for n, (a, b, t) in enumerate(srt, 1)))
    # Visible SI notice (Space Apps rule: SI-generated media must carry a watermark) + SI disclosure in metadata.
    wm = HERE / "watermark-voiced.png"
    n_in = len(NARRATION) + 1
    filters.append(f"[0:v][{n_in + 1}:v]overlay=0:0:format=auto,format=yuv420p[vout]")
    note = (f"SI disclosure: narration voice generated with ElevenLabs ({VOICE_ID}, {MODEL_ID}) from a script written by the team "
            "with AI assistance; screen recording of the real application, whose code was written with AI assistance (Anthropic Claude Code). See AI_USE.md.")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-i", str(srt_path), "-i", str(wm), "-filter_complex", ";".join(filters),
                    "-map", "[vout]", "-map", "[aout]", "-map", f"{n_in}:s", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
                    "-c:a", "aac", "-b:a", "192k", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng",
                    "-metadata", "title=Trend Detective: guided tour (Space Apps 2026)", "-metadata", f"comment={note}",
                    "-metadata", "description=SI-assisted project with AI-generated narration. See AI_USE.md.",
                    "-metadata:s:a:0", "title=AI-generated narration (ElevenLabs)",
                    "-shortest", "-movflags", "+faststart", out], check=True)
    # also a version with subtitles burned in, for platforms that ignore soft tracks
    burned = str(Path(out).with_name(Path(out).stem + "-subtitled.mp4"))
    style = "FontName=Inter,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=36"
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", out, "-vf", f"subtitles='{srt_path}':force_style='{style}'",
                        "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", burned])
    if r.returncode != 0:
        Path(burned).unlink(missing_ok=True)
        burned = "(skipped: this ffmpeg has no libass; upload the .srt or use the embedded subtitle track)"
    print("wrote", out, "|", burned, "|", srt_path)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "tts":
        tts(offline="--say" in sys.argv)
    elif cmd == "mix":
        mix(*sys.argv[2:5])
    else:
        sys.exit(__doc__)
