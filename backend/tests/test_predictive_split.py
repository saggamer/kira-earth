import pytest
from backend.ai import predictive as P


def _rows(spec):
    return [{"split": s, "end": e, "anchor": a} for s, e, a in spec]


def test_current_split_constants_are_horizon_purged():
    assert P.TRAIN_END + P.HORIZON < P.CALIB_ENDS[0]
    assert P.CALIB_ENDS[1] + P.HORIZON < P.TEST_START


def test_assert_purged_accepts_disjoint_outcomes_and_sites():
    m = P.assert_purged(_rows([("train", 2001, "a"), ("calib", 2007, "a"), ("test", 2015, "z")]))
    assert m["partitions"]["train"]["last_outcome"] == 2006 and m["partitions"]["test"]["first_origin"] == 2015


def test_assert_purged_rejects_overlapping_outcomes():
    """SCI-01: the old split (train ≤ 2009, calibration from 2011) must fail."""
    with pytest.raises(ValueError, match="Temporal leakage"):
        P.assert_purged(_rows([("train", 2009, "a"), ("calib", 2011, "a"), ("test", 2015, "z")]))
    with pytest.raises(ValueError, match="Temporal leakage"):
        P.assert_purged(_rows([("train", 2001, "a"), ("calib", 2013, "a"), ("test", 2015, "z")]))


def test_assert_purged_rejects_shared_sites():
    with pytest.raises(ValueError, match="Site leakage"):
        P.assert_purged(_rows([("train", 2001, "a"), ("test", 2015, "a")]))


def test_split_of_uses_purged_origins():
    assert P.split_of({"outcome": {}, "anchor": "x", "end": 2009}) in ("calib", None)
    assert P.split_of({"outcome": {}, "anchor": "x", "end": 2011}) is None or P.pool_of("x") == "test"
