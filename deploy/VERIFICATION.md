# Hackathon delivery verification — 15 November 2026

## Published artifacts

- App: https://kira-earth.onrender.com
- Public code: https://github.com/saggamer/kira-earth
- Video release: https://github.com/saggamer/kira-earth/releases/tag/hackathon-demo-v1
- Video: 30.000 seconds; H.264 1920 × 1080, 30 fps; AAC; selectable English subtitle track and separate SRT. File size 6,934,610 bytes.
- The GitHub asset SHA-256 matches the local delivery: `dc8224d5f3bbc0fc5531ff8d07746385af8035387148dc0e1b317cfb1dbeca99`. Public unauthenticated download returned HTTP 200.
- Kokoro voice disclosure is visible throughout the film, spoken at the end, and present in metadata. All six phrases fit their timing slots. Final decoded frames were inspected; audio is non-silent, with peak −3.4 dB. Audio was measured, not listened to by the assistant.

## Checks

- `npm run build`: passed.
- Python suite: 105 passed. Node suite: 21 passed.
- HyperFrames final check: zero errors in lint, runtime, layout, contrast, craft and audio. One reviewed warning is the intentional local 2.5-second media offset inside the evidence scene.
- Git source excludes credentials, models, provider cache, Python environment, editor caches and Node dependencies.

## Hosted browser checks

- `/api/health`: HTTP 200.
- `/api/settings/keys` with `X-Earth-Client: 1`: HTTP 403. Public deployment mode also blocks updates, deletes and tests; covered by a regression test.
- Cairo Studio: 1981–2025 NASA POWER record, coordinate identity and provenance shown. The strongest ranked change is minimum temperature, +0.39 °C/decade.
- Cairo forecast: real WeatherNext 2 64-member ensemble, current weather fields, future daily forecast dates and climate context returned.
- Regional Compare: Cairo vs Nairobi, 2001–2024, temperature, 2° × 2° boxes, three-month lag. Both report nine samples and full daily coverage. Descriptive slopes are approximately +0.31 and +0.14 °C/decade; no regional-difference significance claim is made. A → B response withheld because added-source validation skill was −4.0%.
- Phone: user reported that the globe and Explore Cairo load correctly. Other mobile flows were not independently tested.
- Safari private-window test: unavailable because Screen Time disallows private browsing. No protection or setting was changed. Standard browser checks succeeded.

## Deployment scope

The first Render deployment built and started successfully in 1 min 15 s from app commit `1313d2d794011e48a52747da2618bbdde514303e`. Free compute is 0.1 CPU / 512 MB in Ohio. The Docker container serves the frontend and API on one origin. The stored logistic model is available, but the optional Laya resemblance model is not installed. No cloud explanation API key or paid hardware was enabled. Free sleep/cold-start and ephemeral-cache limits remain. No custom domain has been purchased or attached.

Screenshots from the public application: [regional comparison](verification-comparison.jpg), [forecast](verification-forecast.jpg).
