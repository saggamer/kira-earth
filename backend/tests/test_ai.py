"""AI layer: tectonic scoping, locally calibrated indices, trend signatures, analog retrieval,
escalation inputs and outlook guards. Synthetic fixtures only; never used by the application."""
from datetime import date, timedelta
import numpy as np
import pytest
from backend.ai import signatures as S
from backend.ai.tectonics import plate_at, tectonic_context
from backend.ai import engine, outlook


def daily_payload(start, end, temp=lambda d, i: 20.0, rain=lambda d, i: 2.0):
    data = {k: {} for k in ("T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR")}
    day, i = date(start, 1, 1), 0
    rng = np.random.default_rng(5)
    while day.year <= end:
        t = temp(day, i) + rng.normal(0, .5)
        key = day.strftime("%Y%m%d")
        data["T2M"][key], data["T2M_MAX"][key], data["T2M_MIN"][key] = t, t + 5, t - 5
        data["PRECTOTCORR"][key] = max(0.0, rain(day, i) + rng.normal(0, .3))
        day += timedelta(days=1)
        i += 1
    return {"header": {"fill_value": -999}, "properties": {"parameter": data}}


@pytest.mark.parametrize("lat,lon,plate", [(11.0, 77.0, "IN"), (51.5, -0.1, "EU"), (21.3, -157.8, "PA"), (-25.0, 134.0, "AU"), (40.0, -100.0, "NA")])
def test_plate_lookup(lat, lon, plate):
    assert plate_at(lat, lon) == plate


def test_boundary_neighbours_only_when_close():
    interior = tectonic_context(21.3, -157.8)          # Honolulu: far from any boundary
    assert interior["searched_plates"] == ["PA"]
    edge = tectonic_context(64.14, -21.94)             # Reykjavík: on the Mid-Atlantic Ridge
    assert edge["searched_plates"][0] == "NA" and "EU" in edge["searched_plates"]
    assert all(n["boundary_distance_km"] <= 600 for n in edge["neighbours"])


def test_warming_window_is_significant_and_classified_as_heat():
    year_noise = dict(zip(range(1981, 2025), np.random.default_rng(11).normal(0, .12, 44)))
    p = daily_payload(1981, 2024, temp=lambda d, i: 15 + .06 * (d.year - 1981) + year_noise[d.year] + 8 * np.sin(2 * np.pi * d.timetuple().tm_yday / 365.25))
    df = S.annual_indices(p, 1981, 2024)
    sigma = S.scales(df)
    sig = S.window_signature(df, 2024, sigma)
    assert sig["trends"]["t_mean"]["slope"] == pytest.approx(.6, abs=.1)   # °C per decade
    assert sig["trends"]["t_mean"]["significant"] is True
    assert S.classify(sig) in {"heat", "warm_nights"}


def test_stationary_climate_has_no_regime():
    p = daily_payload(1981, 2024)
    df = S.annual_indices(p, 1981, 2024)
    sig = S.window_signature(df, 2024, S.scales(df))
    assert sig["n_significant"] <= 1
    assert S.classify(sig) in {"no_clear_regime", "warm_nights", "heat", "cooling", "drying", "wetting", "extreme_rain"}


def test_incomplete_year_is_excluded_not_filled():
    p = daily_payload(2000, 2002)
    for k in p["properties"]["parameter"]:
        for key in list(p["properties"]["parameter"][k]):
            if key.startswith("2001") and key < "20010301":
                p["properties"]["parameter"][k][key] = -999
    df = S.annual_indices(p, 2000, 2002)
    assert np.isnan(df.loc[2001, "t_mean"]) and np.isfinite(df.loc[2000, "t_mean"])


def test_outcome_requires_full_horizon():
    p = daily_payload(1981, 2024)
    df = S.annual_indices(p, 1981, 2024)
    sigma = S.scales(df)
    assert S.outcome(df, 2019, sigma) is not None
    assert S.outcome(df, 2021, sigma) is None


def test_candidates_stay_on_searched_plates_and_in_the_past():
    lib = engine.library()
    vec = lib["vectors"][0]
    chosen = engine.candidates(vec, 20, 1000, 11, 77, ["IN"], before_year=2010)
    assert chosen and all(lib["episodes"][i]["plate"] == "IN" for i, _ in chosen)
    assert all(lib["episodes"][i]["end"] + S.OUTCOME <= 2010 for i, _ in chosen)
    assert len({lib["episodes"][i]["anchor"] for i, _ in chosen}) == len(chosen)
    assert all(lib["episodes"][i]["n_significant"] > 0 for i, _ in chosen)


def test_severity_rules():
    assert engine.severity_label(30, 0) == 0
    assert engine.severity_label(97, 0) == 1      # extreme magnitude but nothing significant: capped
    assert engine.severity_label(60, 5) == 2      # many significant indices: at least significant
    assert engine.severity_label(97, 3) == 3


def _sys1(skilful, rise, clim_rise=.3, rpss=.15):
    o = {"label": "number of hot days", "probabilities": {"fall": (1 - rise) / 2, "steady": (1 - rise) / 2, "rise": rise},
         "climatology": {"fall": (1 - clim_rise) / 2, "steady": (1 - clim_rise) / 2, "rise": clim_rise}, "skilful": skilful, "rpss": rpss}
    return {"status": "ok", "outlook": {"hot_days": o}}


def test_outlook_confidence_is_computed_not_generated():
    assert outlook.confidence_rating({"system1": {"status": "unavailable"}})["label"] == "low"
    assert outlook.confidence_rating({"system1": _sys1(False, .9)})["label"] == "low"   # no verified skill → never confident
    assert outlook.confidence_rating({"system1": _sys1(True, .3)})["label"] == "low"    # says nothing beyond climatology
    assert outlook.confidence_rating({"system1": _sys1(True, .8, rpss=.25)})["label"] == "high"
    sections = outlook.parse("LIKELY NEXT: a\nHAZARDS TO WATCH: b\nMONITOR: c")
    assert sections == {"likely_next": "a", "hazards": "b", "monitor": "c"}


def test_unskilled_answers_are_never_stated_as_forecasts():
    lines = outlook.grounded_summary({"system1": _sys1(False, .9)})
    assert "no verified forecast skill" in lines[0] and "%" not in lines[0]
    assert "90% chance to rise" in outlook.grounded_summary({"system1": _sys1(True, .9)})[0]


def test_predictive_labels_scores_and_split():
    import numpy as np
    from backend.ai import predictive as P
    assert [P.label(v) for v in (-.8, 0, .49, .51)] == ["fall", "steady", "steady", "rise"]
    y = np.array([0, 1, 2, 2])
    clim = np.array([1 / 3] * 3)
    perfect = np.eye(3)[y]
    assert P.rpss(perfect, y, clim) == 1.0
    assert abs(P.rpss(np.tile(clim, (4, 1)), y, clim)) < 1e-12
    ep = lambda a, end: {"anchor": a, "end": end, "outcome": {}}
    test_site = next(f"X-{i}" for i in range(100) if P.pool_of(f"X-{i}") == "test")
    train_site = next(f"X-{i}" for i in range(100) if P.pool_of(f"X-{i}") == "train")
    assert P.split_of(ep(test_site, 2017)) == "test" and P.split_of(ep(test_site, 2005)) is None
    assert P.split_of(ep(train_site, 2001)) == "train" and P.split_of(ep(train_site, 2009)) == "calib"
    assert P.split_of(ep(train_site, 2005)) is None and P.split_of(ep(train_site, 2011)) is None   # purged gaps
    assert P.split_of(ep(train_site, 2017)) is None   # later years of training sites are never used


def test_number_guard_drops_invented_figures():
    clean, removed = outlook.guard_numbers({"likely_next": "Rain rose 0.9σ. It rose 1.5 times since 1990. Watch hot days."}, "rain +0.9σ, 2010–2024")
    assert removed == 1 and clean["likely_next"] == "Rain rose 0.9σ. Watch hot days."


def test_logistic_baseline_learns_and_exports():
    import numpy as np
    from backend.ai import predictive as P
    rng = np.random.default_rng(0)
    X = rng.normal(size=(600, 3))
    y = np.digitize(X[:, 0] + rng.normal(0, .3, 600), [-.5, .5])  # class driven by feature 0
    predict, params = P.fit_logistic(X, y)
    p = predict(X)
    assert np.allclose(p, P.logistic_predict(params, X)) and np.allclose(p.sum(1), 1)
    clim = np.bincount(y, minlength=3) / len(y)
    assert P.rpss(p, y, clim) > .4


def test_state_text_uses_words_and_no_future():
    from backend.ai import predictive as P
    trends = {k: {"z": 0.0, "significant": False, "recent": 0.0} for k in S.KEYS}
    trends["hot_days"] = {"z": 2.4, "significant": True, "recent": 1.1}
    text = P.state_text("EU", {"t_mean": 25, "rain": 200}, {"trends": trends, "end": 2024})
    assert "hot days: strongly rising (significant), recent years far above the trend" in text
    assert "hot, very dry" in text and "2025" not in text


def _window(zs):
    return {"trends": {k: {"z": z, "significant": abs(z) > 1.5} for k, z in zip(S.KEYS, zs)}}


def test_similarity_counts_matching_trend_changes():
    from backend.ai import similarity as M
    a = _window([1.5, 1.4, 1.6, -.4, 1.0, .9, -1.0, 0.1, 0.0])
    assert M.true_similarity(a, a) == 1.0
    b = _window([1.3, 1.1, 1.8, .4, 1.0, .9, -1.0, 0.1, 0.0])    # rainfall flips direction
    assert M.true_similarity(a, b) == pytest.approx(8 / 9)
    assert M.index_match(.1, -.2)            # both flat
    assert not M.index_match(.5, -.5)        # opposite directions
    assert not M.index_match(.5, 2.0)        # same direction, very different strength
    assert M.index_match(3.0, 3.9)           # within 35 % of a strong trend


def test_pair_text_shows_both_trends_and_no_outcome():
    from backend.ai import similarity as M
    a, b = _window([1.6] * 9), _window([-1.0] * 9)
    b["outcome"] = {"shift": {k: 9.9 for k in S.KEYS}}
    t = M.pair_text(a, b)
    assert "rising +1.6* | falling -1.0;" in t and "9.9" not in t


def test_similarity_gate_feeds_analogs_into_the_prompt():
    from backend.ai import similarity as M
    ctx = {"similarity": {"status": "ok", "average": .74, "gate": M.GATE, "analogs": [
        {"period": [2000, 2014], "plate": "IN", "laya_similarity": .76, "outcome": {"shift": {k: (.8 if k == "hot_days" else .1) for k in S.KEYS}}}]}}
    lines = outlook.analog_lines(ctx)
    assert "74%" in lines[0] and "70%" in lines[0]
    assert lines[1].split(": ", 1)[1].startswith("hot days") and "+0.8σ" in lines[1]
    assert outlook.analog_lines({"similarity": {"status": "unavailable"}}) == []


def test_cloud_model_is_preferred_and_local_servers_are_not_cloud(tmp_path, monkeypatch):
    from backend import keystore
    from backend.ai import outlook
    for var in ("EARTH_LLM_PROVIDER", "EARTH_ANTHROPIC_KEY", "EARTH_LLM_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(keystore, "FILE", tmp_path / "keys.json")
    assert outlook.config()["cloud"] is False                       # nothing saved: small local model
    keystore.put("llm", None, {"url": "http://127.0.0.1:11434/v1", "model": "llama3"})
    assert outlook.public() == {"provider": "openai", "model": "llama3", "cloud": False}
    keystore.put("llm", "sk-test", {"url": "https://api.openai.com/v1", "model": "gpt"})
    assert outlook.config()["cloud"] is True
    keystore.put("anthropic", "test-key-1234")
    cfg = outlook.config()
    assert (cfg["provider"], cfg["model"], cfg["cloud"]) == ("anthropic", outlook.CLOUD_DEFAULT, True)
    assert "key" not in outlook.public()


def test_anthropic_reply_is_text_only_and_refusals_raise(monkeypatch):
    import types
    import anthropic
    from backend.ai import outlook
    sent = {}

    class FakeMessages:
        def create(self, **kw):
            sent.update(kw)
            blocks = [types.SimpleNamespace(type="thinking", thinking=""), types.SimpleNamespace(type="text", text=" LIKELY NEXT: x ")]
            return types.SimpleNamespace(stop_reason=sent.get("_stop", "end_turn"), content=blocks)

    class FakeClient:
        def __init__(self, **kw):
            self.beta = types.SimpleNamespace(messages=FakeMessages())

    monkeypatch.setattr(anthropic, "Anthropic", FakeClient)
    cfg = {"provider": "anthropic", "model": "claude-opus-5-5", "key": "k", "cloud": True}
    assert outlook._generate_anthropic("p", "s", 230, cfg) == "LIKELY NEXT: x"
    assert sent["model"] == "claude-opus-5-5" and sent["system"] == "s" and "temperature" not in sent
    FakeMessages.create = lambda self, **kw: types.SimpleNamespace(stop_reason="refusal", content=[])
    try:
        outlook._generate_anthropic("p", "s", 230, cfg)
        raise AssertionError("refusal should raise")
    except RuntimeError:
        pass


def test_key_test_checks_that_entry_not_the_fallback(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from backend import keystore, main
    from backend.ai import outlook
    monkeypatch.delenv("EARTH_ANTHROPIC_KEY", raising=False)
    monkeypatch.setattr(keystore, "FILE", tmp_path / "keys.json")
    called = []
    monkeypatch.setattr(outlook, "_generate_local", lambda *a, **k: called.append("local") or "ready")
    r = TestClient(main.app).post("/api/settings/keys/anthropic/test", headers={"x-earth-client": "1"}).json()
    assert r["ok"] is False and not called                       # no Claude key: never "passes" via the local model
    keystore.put("anthropic", "test-key-1234")
    monkeypatch.setattr(outlook, "_generate_anthropic", lambda prompt, system, n, cfg: "ready")
    r = TestClient(main.app).post("/api/settings/keys/anthropic/test", headers={"x-earth-client": "1"}).json()
    assert r["ok"] is True and "cloud" in r["message"] and not called


def test_direction_guard_drops_claims_for_unverified_questions():
    """SCI-05: analogs must not introduce directional predictions for questions without verified skill."""
    ctx = {"system1": {"status": "ok", "outlook": {
        "t_mean": {"skilful": True}, "hot_days": {"skilful": False}, "heavy_rain": {"skilful": False}, "dry_spell": {"skilful": False}}}}
    text = {"likely_next": "Average temperature is most likely to stay steady. Dry spells will get longer, as in two past matches. Hot days rise too."}
    out, removed = outlook.guard_directions(text, ctx)
    assert removed == 2 and out["likely_next"] == "Average temperature is most likely to stay steady."


def test_evidence_strength_ignores_resemblance():
    sys1 = {"status": "ok", "outlook": {"t_mean": {"skilful": True, "rpss": .11, "probabilities": {"fall": .2, "steady": .7, "rise": .1},
                                                   "climatology": {"fall": .15, "steady": .48, "rise": .37}}}}
    base = outlook.confidence_rating({"system1": sys1})
    low_sim = outlook.confidence_rating({"system1": sys1, "similarity": {"status": "ok", "analogs": [1], "average": .3, "gate": .7}})
    assert base["score"] == low_sim["score"] and "not calibrated" in base["kind"]
