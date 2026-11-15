# Hackathon deployment plan

## Recommended order

1. Publish the public GitHub source and the 30-second demo release.
2. Deploy the existing single-container Dockerfile. It builds the frontend and serves it with FastAPI, so no separate frontend rewrite is needed.
3. Verify Cairo Studio, the forecast and Compare on the deployed URL. Connect a domain only after this passes.

## Ready-to-deploy free profile

`render.yaml` describes a **free** Render web service. Import this repository as a Blueprint: https://dashboard.render.com/select-repo?type=blueprint . This requires a Render account and authorization to read this public repo. The first build must finish before any live URL is claimed. The Blueprint explicitly uses `plan: free`; no paid hardware is selected. Free instances can sleep and cold-start, and their local cache is ephemeral.

Hugging Face Docker creation was attempted with `cpu-basic` and rejected with HTTP 402 because the account lacks PRO. No plan or paid hardware was purchased. `deploy/hf-space.sh` remains available for a qualifying account.

## Important: lightweight hosting is not the full local AI stack

The default Dockerfile uses `requirements-deploy.txt`, excludes all model weights, and does not install PyTorch / transformers. NASA trend calculations, imagery, comparisons and forecasts remain provider-backed; the Laya similarity layer is unavailable and falls back to its documented rule-based path. Do not advertise the default hosted profile as running Laya. The saved predictive configuration is `backend/ai/data/system1-config.json`.

For a host that runs Laya, include the base tokenizer/config files and base weights plus the similarity checkpoint from a model registry, install the relevant CPU or CUDA dependencies, and benchmark RAM and concurrency. Keep large checkpoints outside ordinary Git. Do not copy the Mac virtual environment. Running local Qwen requires additional memory and download time; a configured external explanation API is optional.

## Public deployment settings

- The image sets `EARTH_PUBLIC_MODE=1`, disabling key-management endpoints even if a proxy connects over loopback. Put optional provider keys in the host's secret store, never in the frontend, repository or Docker image.
- The process binds to `0.0.0.0:$PORT` and serves `dist/` after the API routes.
- NASA / satellite / weather APIs require outbound networking. An HTTP 200 health check alone does not verify these data paths.
- Use one worker initially; measure concurrency before increasing workers. Each model worker would load its own weights.
- Budget limits and rate limiting should be added before enabling a publicly funded explanation API.

## Acceptance checks after deployment

- `/api/health` succeeds; the home page, JavaScript and Cesium assets load.
- Cairo Studio returns the expected coordinates, full period and sources.
- Forecast dates and provider freshness are visible; failures remain explicit.
- Compare returns both requested region identities and units.
- `/api/settings/keys` stays forbidden, including with `X-Earth-Client: 1`.
- Test from a private browser window and an actual phone. Do not mark phone testing complete from a desktop resize.

## Domain

A custom domain is optional for judging: the host's HTTPS URL is enough. The user has discussed several domain names but has not selected a confirmed purchase for this deployment. Do not buy a domain without a specific name and approved price.
