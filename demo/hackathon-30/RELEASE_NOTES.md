A 30-second demonstration of KIRA Earth / Earth System Trend Detective for the hackathon.

**Live app:** https://kira-earth.onrender.com

The live app was checked through Cairo Studio, WeatherNext 2 forecast and Cairo–Nairobi regional Compare. The user also confirmed that the globe and Cairo load on a phone. Render Free may need 50 seconds or more to wake after inactivity.

**AI disclosure:** the narration voice is generated locally using **Kokoro-82M, af_heart**. This is disclosed on screen throughout, spoken in the outro, and stored in the video metadata. No voice cloning was used. The footage is an edited recording of the actual application, with AI-assisted captions and an end card made using HyperFrames. It is not a continuous live interaction or a claim about cloud response times.

The film follows Cairo's climate-variable ranking, climate spiral, significance test, satellite cross-check and an Aral Sea imagery swipe.

Assets:
- `kira-earth-hackathon-30s.mp4`: 1920 × 1080, 30 fps, H.264/AAC, exactly 30 seconds; English subtitle track included.
- `captions.srt`: English narration subtitles.
- `poster.jpg`: a frame from the completed demo.

The application source, editable video source, AI disclosure and submission kit are in this public repository. The default Docker profile runs without the optional Laya weights; see `deploy/HACKATHON_DEPLOYMENT.md` for the distinction between local and lightweight hosted modes.

Validation: production frontend build passed; 105 Python and 21 Node tests passed.
