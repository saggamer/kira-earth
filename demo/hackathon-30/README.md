# KIRA Earth — 30-second hackathon demo

**Voice disclosure:** narration is AI-generated locally with Kokoro-82M, voice `af_heart`. No voice cloning was used. The notice appears throughout the video, is spoken at the end, and is included in MP4 metadata.

The visual sequence uses edited footage from the real Trend Detective app: globe → Cairo ranking → climate spiral → significance test → satellite cross-check → Aral Sea swipe. It is not a continuous live interaction and does not imply that data loaded in 30 seconds. Overlay captions and the end card were made with HyperFrames and AI coding assistance. Scientific numbers shown in the recording came from the application; no values were generated for the video.

## Files

- `kira-earth-hackathon-30s.mp4`: final 1920 × 1080, 30 fps, 30.000-second H.264/AAC delivery (GitHub Release asset).
- `captions.srt`: English narration subtitles, also embedded as a selectable MP4 subtitle track.
- `index.html`, `compositions/`, `assets/`: editable, seekable HyperFrames source.
- `narration.json`: exact spoken script and timing slots.
- `SPEC.md`, `STORYLINES.md`, `REVIEW.md`: creative brief and verification notes.

## Re-render

Use Node.js 22+, FFmpeg and HyperFrames 0.9.53:

```sh
cd demo/hackathon-30
npm run check
npx --yes hyperframes@0.9.53 preview --background
npm run render -- --quality delivery -o output.mp4
ffmpeg -i output.mp4 -i captions.srt -map 0:v -map 0:a -map 1:0 -c copy -c:s mov_text -metadata title="KIRA Earth — 30-second hackathon demo" -metadata comment="AI-generated voiceover: Kokoro-82M (af_heart). Edited real application footage; captions and end card assisted by OpenAI Codex using HyperFrames." -movflags +faststart kira-earth-hackathon-30s.mp4
```

The source clips are intentionally short; original two-minute footage and legacy ElevenLabs audio are not included in the Git source. Kokoro source: https://huggingface.co/hexgrad/Kokoro-82M (Apache-2.0); local ONNX runtime: https://github.com/thewh1teagle/kokoro-onnx .
