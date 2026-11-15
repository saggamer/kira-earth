"""Local API-key store for optional forecast, hazard and LLM providers.

Keys live only on this computer, in a JSON file with owner-only permissions
(default backend/.secrets/keys.json, override with EARTH_SECRETS_FILE). The API
never returns a stored key; it reports whether one is set and its last 4 characters.
An environment variable (see PROVIDERS[...]["env"]) always takes precedence.
"""
from __future__ import annotations
import json
import os
import threading
from pathlib import Path

FILE = Path(os.getenv("EARTH_SECRETS_FILE", str(Path(__file__).parent / ".secrets" / "keys.json")))
_lock = threading.Lock()

PROVIDERS: dict[str, dict] = {
    "anthropic": {
        "label": "Claude (cloud System-2 model)", "kind": "llm", "env": "EARTH_ANTHROPIC_KEY",
        "docs": "https://console.anthropic.com/settings/keys",
        "note": "The larger model that predicts when Laya's similarity gate opens. Default model claude-opus-5-5. "
                "Only computed trend statistics and analog summaries are sent, never the raw NASA record.",
        "fields": {"model": "Model (optional, default claude-opus-5-5)"},
    },
    "llm": {
        "label": "Other model (OpenAI-compatible)", "kind": "llm", "env": "EARTH_LLM_KEY",
        "docs": "https://platform.openai.com/docs/api-reference/chat",
        "note": "Any OpenAI-compatible chat API (OpenAI, OpenRouter, Groq…), or a local server such as Ollama with no key. "
                "Used when no Claude key is saved; a local server counts as a small model, not the cloud one.",
        "fields": {"url": "Base URL, e.g. https://api.openai.com/v1 or http://127.0.0.1:11434/v1", "model": "Model name"},
    },
    "openweathermap": {
        "label": "OpenWeather One Call 3.0", "kind": "forecast", "env": "OPENWEATHER_API_KEY",
        "docs": "https://openweathermap.org/api/one-call-3",
        "note": "Hourly 48 h, daily 8 days and government alerts. Needs the One Call 3.0 subscription (1,000 free calls/day).",
    },
    "weatherapi": {
        "label": "WeatherAPI.com", "kind": "forecast", "env": "WEATHERAPI_KEY",
        "docs": "https://www.weatherapi.com/docs/",
        "note": "Hourly and daily forecast plus alerts. The free plan returns 3 days.",
    },
    "tomorrow": {
        "label": "Tomorrow.io", "kind": "forecast", "env": "TOMORROW_API_KEY",
        "docs": "https://docs.tomorrow.io/reference/weather-forecast",
        "note": "Hourly 120 h and daily 6 days.",
    },
    "nasa_firms": {
        "label": "NASA FIRMS (active fires)", "kind": "hazard", "env": "NASA_FIRMS_MAP_KEY",
        "docs": "https://firms.modaps.eosdis.nasa.gov/api/map_key/",
        "note": "VIIRS satellite fire detections near the selected place, last 48 h. Free MAP_KEY.",
    },
}


def _read() -> dict:
    try:
        return json.loads(FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write(data: dict) -> None:
    FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(FILE.parent, 0o700)
    except OSError:
        pass  # exFAT and some network drives ignore POSIX modes
    tmp = FILE.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    tmp.replace(FILE)


def get(provider: str) -> str | None:
    """The usable key: environment variable first, then the local store."""
    spec = PROVIDERS[provider]
    env = os.getenv(spec["env"])
    if env:
        return env
    with _lock:
        return (_read().get(provider) or {}).get("key") or None


def extra(provider: str, field: str) -> str | None:
    with _lock:
        return (_read().get(provider) or {}).get(field) or None


def put(provider: str, key: str | None, fields: dict[str, str] | None = None) -> None:
    if provider not in PROVIDERS:
        raise KeyError(provider)
    with _lock:
        data = _read()
        entry = data.get(provider) or {}
        if key is not None:
            entry["key"] = key.strip()
        for name, value in (fields or {}).items():
            if name in PROVIDERS[provider].get("fields", {}):
                entry[name] = value.strip()
        data[provider] = {k: v for k, v in entry.items() if v}
        _write(data)


def delete(provider: str) -> None:
    with _lock:
        data = _read()
        data.pop(provider, None)
        _write(data)


def mask(key: str | None) -> str | None:
    if not key:
        return None
    return "••••" + key[-4:] if len(key) > 8 else "••••"


def status() -> list[dict]:
    with _lock:
        data = _read()
    out = []
    for pid, spec in PROVIDERS.items():
        stored = (data.get(pid) or {})
        env = bool(os.getenv(spec["env"]))
        key = os.getenv(spec["env"]) or stored.get("key")
        out.append({"id": pid, "label": spec["label"], "kind": spec["kind"], "docs": spec["docs"], "note": spec["note"],
                    "configured": bool(key) or (pid == "llm" and bool(stored.get("url"))),
                    "source": "environment" if env else "local file" if stored else None, "masked": mask(key),
                    "env": spec["env"], "fields": {name: {"label": label, "value": stored.get(name)}
                                                     for name, label in spec.get("fields", {}).items()}})
    return out
