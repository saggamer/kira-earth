# Earth System Trend Detective — single container: FastAPI serves the API and the built frontend.
# Works on Hugging Face Spaces (Docker SDK, port 7860), Render, Railway, Fly.io or any Docker host.

# ---- 1. build the frontend
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
RUN npx vite build

# ---- 2. runtime
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    EARTH_CACHE_DIR=/tmp/earth-cache EARTH_STATIC=/app/dist EARTH_PUBLIC_MODE=1 PORT=7860
WORKDIR /app
COPY requirements-deploy.txt ./
RUN pip install --no-cache-dir -r requirements-deploy.txt
COPY backend ./backend
COPY --from=web /app/dist ./dist
# Hugging Face Spaces runs containers as uid 1000
RUN useradd -m -u 1000 app && mkdir -p /tmp/earth-cache && chown -R app /app /tmp/earth-cache
USER app
EXPOSE 7860
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-7860} --proxy-headers"]
