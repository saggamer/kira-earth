# Demo recording

`trend-detective-tour.mp4` — the in-app guided tour (11 steps), 1920×1080, H.264, about 2 min, recorded from the running app. It carries a visible **AI · SI** notice (Space Apps SI rules) and an SI disclosure in its metadata (`comment`). See `../AI_USE.md`.

To re-record after changes (needs Google Chrome and ffmpeg; the app running on :5174 with its API):

```sh
mkdir -p /tmp/rec && cd /tmp/rec && npm init -y >/dev/null && npm install playwright-core@1.49.1
cp "<project>/demo/record-tour.mjs" . && node record-tour.mjs http://localhost:5174 "<project>/demo/trend-detective-tour.mp4"
```

Run it twice, or warm the backend first (`POST /api/ai/warmup`, open the trend map for Cairo once), so first-time data fetches don't appear as waiting time in the video.

## SI watermark and voiceover

- `watermark.py` renders the notice (`watermark-silent.png`, `watermark-voiced.png`; needs Pillow). Apply it with
  `ffmpeg -i raw.mp4 -i watermark-silent.png -filter_complex "[0:v][1:v]overlay=0:0" … out.mp4`.
- Voiced version: `python demo/voiceover.py tts` (ElevenLabs key in `backend/.secrets/elevenlabs.key`), then
  `node record-tour.mjs <url> raw.mp4 --voice demo/voice/durations.json --narration demo/narration.json`, then
  `python demo/voiceover.py mix raw.mp4 raw.steps.json demo/trend-detective-tour-voiced.mp4`. The mix adds the voiced
  watermark, an English subtitle track plus `.srt`, and SI metadata on the video, the audio track and each narration file.
