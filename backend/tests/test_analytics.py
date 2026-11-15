from datetime import date
import numpy as np
import pytest
from backend.analytics import longest_run, block_sample
from backend.science import analyze
from backend.tests.test_science import payload

def combined(years, missing=None):
    a=payload(years,missing)
    for key,value in [('T2M_MAX',36),('T2M_MIN',22),('PRECTOTCORR',1)]:
        a['properties']['parameter'].update(payload({y:value for y in years},missing,key)['properties']['parameter'])
    return a

def test_block_sample_is_reproducible_and_preserves_length():
    a=block_sample(np.arange(11),np.random.default_rng(413),3)
    b=block_sample(np.arange(11),np.random.default_rng(413),3)
    assert np.array_equal(a,b)
    assert len(a)==11
    assert set(a)<=set(range(11))

def test_spells_break_at_false_and_empty_is_zero():
    assert longest_run([True,True,False,True,True,True])==3
    assert longest_run([])==0

def test_daily_extremes_respect_leap_year_and_fixed_thresholds():
    r=analyze(combined({2020:25,2021:25,2022:25}),'T2M',2020,2022)['analysis']
    y=r['extremes'][0]
    assert y['hot_days']==366
    assert y['tropical_nights']==366
    assert y['frost_nights']==0
    assert y['wet_days']==366
    assert y['longest_wet_spell']==366
    assert y['longest_dry_spell']==0
    assert y['rx5day']==5
    assert y['diurnal_range']==14

def test_missing_day_excludes_extreme_year_without_scaling():
    r=analyze(combined({2020:25,2021:25,2022:25},lambda d:d==date(2021,1,1)),'PRECTOTCORR',2020,2022)['analysis']
    y=r['extremes'][1]
    assert y['wet_days'] is None
    assert y['hot_days'] is None
    assert r['quality']['missing_days']==1
    assert r['quality']['longest_missing_run']==1
    assert r['quality']['excluded_years']==[2021]

def test_seasonal_rainfall_is_monthly_total_not_daily_rate():
    r=analyze(combined({2020:25,2021:25,2022:25}),'PRECTOTCORR',2020,2022)['analysis']
    assert r['seasonal_cycle'][0]['mean']==31
    assert r['seasonal_cycle'][1]['mean']==pytest.approx((29+28+28)/3)

def test_block_bootstrap_recovers_known_slope():
    r=analyze(combined({y:20+.1*(y-2001) for y in range(2001,2025)}),'T2M',2001,2024)['analysis']
    assert r['robust_trend']['slope']==pytest.approx(1)
    assert r['robust_trend']['low']==pytest.approx(1)
    assert r['robust_trend']['high']==pytest.approx(1)
    assert r['period_comparison']['difference']==pytest.approx(1.2)

def test_gaps_withhold_block_bootstrap():
    years={y:20+.1*(y-2001) for y in range(2001,2025) if y!=2012}
    r=analyze(combined(years),'T2M',2001,2024)['analysis']
    assert r['robust_trend'] is None
    assert r['period_comparison']['interval'] is None

def test_absent_variables_stay_missing_not_zero():
    r=analyze(payload({2020:25,2021:25,2022:25}),'T2M',2020,2022)['analysis']
    assert all(v['hot_days'] is None and v['wet_days'] is None for v in r['extremes'])
