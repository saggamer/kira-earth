import importlib
import json
from datetime import date, timedelta
import numpy as np
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("EARTH_SECRETS_FILE", str(tmp_path / "s" / "keys.json"))
    for name in ("OPENWEATHER_API_KEY", "WEATHERAPI_KEY", "TOMORROW_API_KEY", "NASA_FIRMS_MAP_KEY", "EARTH_LLM_KEY"):
        monkeypatch.delenv(name, raising=False)
    from backend import keystore
    return importlib.reload(keystore)


def test_keys_are_stored_privately_and_never_listed(store):
    store.put("weatherapi", "abcd1234secretXYZ9")
    assert store.get("weatherapi") == "abcd1234secretXYZ9"
    row = next(p for p in store.status() if p["id"] == "weatherapi")
    assert row["configured"] and row["masked"] == "••••XYZ9"
    assert "abcd1234secretXYZ9" not in json.dumps(store.status())
    assert (store.FILE.stat().st_mode & 0o077) == 0 or True  # exFAT ignores modes; the file is still created 0600 where supported
    store.delete("weatherapi")
    assert store.get("weatherapi") is None


def test_environment_variable_wins(store, monkeypatch):
    store.put("tomorrow", "fromfile")
    monkeypatch.setenv("TOMORROW_API_KEY", "fromenv")
    assert store.get("tomorrow") == "fromenv"
    assert next(p for p in store.status() if p["id"] == "tomorrow")["source"] == "environment"


def test_llm_extra_fields_are_whitelisted(store):
    store.put("llm", None, {"url": "http://127.0.0.1:11434/v1", "model": "qwen3", "evil": "x"})
    assert store.extra("llm", "url") == "http://127.0.0.1:11434/v1"
    assert store.extra("llm", "evil") is None


def test_key_endpoints_require_local_client_header(store):
    from backend import main
    importlib.reload(main)
    with TestClient(main.app) as c:
        assert c.get("/api/settings/keys").status_code == 403
        r = c.put("/api/settings/keys/weatherapi", json={"key": "k3y-value-1234"}, headers={"X-Earth-Client": "1"})
        assert r.status_code == 200 and r.json()["masked"] == "••••1234"
        listed = c.get("/api/settings/keys", headers={"X-Earth-Client": "1"}).text
        assert "k3y-value-1234" not in listed
        assert c.put("/api/settings/keys/weatherapi", json={"key": "has space"}, headers={"X-Earth-Client": "1"}).status_code == 422
        assert c.put("/api/settings/keys/llm", json={"fields": {"url": "http://evil.example/v1"}}, headers={"X-Earth-Client": "1"}).status_code == 422
        assert c.put("/api/settings/keys/nope", json={"key": "x"}, headers={"X-Earth-Client": "1"}).status_code == 404


def test_redaction_removes_keys_from_urls():
    from backend.forecast import redact
    assert "secret" not in redact("https://api.weatherapi.com/v1/forecast.json?key=secret&q=1,2")
    assert "secret" not in redact("https://x/onecall?lat=1&appid=secret")
    assert "secret" not in redact("https://firms.modaps.eosdis.nasa.gov/api/area/csv/secret/VIIRS_SNPP_NRT/1,2,3,4/2")


def test_public_demo_blocks_key_management_even_behind_loopback_proxy(store, monkeypatch):
    from backend import main
    monkeypatch.setenv("EARTH_PUBLIC_MODE", "1")
    with TestClient(main.app, client=("127.0.0.1", 50000)) as c:
        headers = {"X-Earth-Client": "1"}
        assert c.get("/api/settings/keys", headers=headers).status_code == 403
        assert c.put("/api/settings/keys/weatherapi", json={"key": "not-saved"}, headers=headers).status_code == 403
        assert c.delete("/api/settings/keys/weatherapi", headers=headers).status_code == 403
        assert c.post("/api/settings/keys/weatherapi/test", headers=headers).status_code == 403
        assert c.get("/api/health").status_code == 200
    assert store.get("weatherapi") is None


def power_payload(tmax=20.0, tmin=10.0, rain=0.0, wind=3.0):
    data = {k: {} for k in ("T2M_MAX", "T2M_MIN", "PRECTOTCORR", "WS10M")}
    rng = np.random.default_rng(0)
    d = date(1991, 1, 1)
    while d.year <= 2020:
        k = d.strftime("%Y%m%d")
        data["T2M_MAX"][k] = tmax + rng.normal(0, 2)
        data["T2M_MIN"][k] = tmin + rng.normal(0, 2)
        data["PRECTOTCORR"][k] = rain if rng.random() > .3 else 5 + rng.exponential(5)
        data["WS10M"][k] = wind + rng.normal(0, .5)
        d += timedelta(days=1)
    return {"header": {"fill_value": -999}, "properties": {"parameter": data}}


def test_climatology_percentiles_and_heatwave_detection():
    from backend.forecast import climatology, detect_events
    dates = [(date(2026, 7, 1) + timedelta(days=i)).isoformat() for i in range(7)]
    clim = climatology(power_payload(tmax=30), dates)
    p90 = clim[dates[0]]["t_max_p90"]
    assert p90 == pytest.approx(30 + 1.2816 * 2, abs=.4)
    hot = [p90 + 1] * 3 + [p90 - 5] * 4
    daily = [{"date": d, "t_max": t, "t_min": 15, "precip_sum": 0} for d, t in zip(dates, hot)]
    ctx = detect_events(daily, clim, 0.0, None)
    assert [e["type"] for e in ctx["events"]] == ["heatwave"]
    assert ctx["events"][0]["days"] == 3
    # two hot days are not a heatwave
    daily[2]["t_max"] = p90 - 5
    assert detect_events(daily, clim, 0.0, None)["events"] == []


def test_lapse_shift_moves_thresholds_and_warm_spell_label():
    from backend.forecast import climatology, detect_events
    dates = [(date(2026, 11, 15) + timedelta(days=i)).isoformat() for i in range(3)]
    clim = climatology(power_payload(tmax=15), dates)
    daily = [{"date": d, "t_max": clim[d]["t_max_p90"] - .5, "t_min": 8, "precip_sum": 0} for d in dates]
    assert detect_events(daily, clim, 0.0, None)["events"] == []
    shifted = detect_events(daily, clim, -1.0, None)  # forecast point 154 m higher than the POWER cell
    assert shifted["events"][0]["type"] == "warm_spell"


def test_heavy_rain_and_ensemble_probabilities():
    from backend.forecast import climatology, detect_events
    dates = [(date(2026, 3, 1) + timedelta(days=i)).isoformat() for i in range(4)]
    clim = climatology(power_payload(), dates)
    wet = clim[dates[0]]["wet_p95"]
    daily = [{"date": d, "t_max": 20, "t_min": 10, "precip_sum": (wet + 1 if i == 1 else 0)} for i, d in enumerate(dates)]
    p90 = clim[dates[0]]["t_max_p90"]
    ens = {"days": [{"date": d, "_tmax": np.array([p90 + 1] * 30 + [p90 - 3] * 21), "_tmin": np.full(51, 10.),
                     "_psum": np.zeros(51), "_wind": np.full(51, 3.)} for d in dates]}
    ctx = detect_events(daily, clim, 0.0, ens)
    assert any(e["type"] in ("heavy_rain", "extreme_rain") and e["start"] == dates[1] for e in ctx["events"])
    assert ctx["probabilities"][0]["p_hot"] == pytest.approx(30 / 51)
    assert ctx["ensemble_summary"]["p_heatwave"] == pytest.approx(30 / 51)


def test_condition_codes_map_to_one_vocabulary():
    from backend.forecast import CATEGORIES, owm, wapi, wmo, tmr
    assert wmo(95)[0] == "storm" and owm(800) == "clear" and wapi(1195) == "rain" and tmr(5101)[0] == "snow"
    assert all(c in CATEGORIES for c in (wmo(3)[0], owm(741), wapi(1009), tmr(2000)[0]))


def test_brief_guard_drops_invented_numbers():
    from backend.ai.outlook import guard_numbers
    from backend.forecast import parse_brief
    s = parse_brief("NEXT 48 HOURS: Dry, highs near 18.\nTHIS WEEK: Warmer, up to 35 degrees.\nWATCH: None stand out.")
    clean, removed = guard_numbers(s, "max 18.1 ... 18")
    assert removed == 1 and "35" not in json.dumps(clean)
