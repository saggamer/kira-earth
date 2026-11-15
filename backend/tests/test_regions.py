from backend.science import PARAMETERS
import asyncio
import numpy as np
import pandas as pd
import pytest
from backend.regions import Region, ComparisonRequest, region_samples, aggregate_region, cross_region_model, boxes_overlap


def monthly(values):
    return [{'date':str(d),'value':float(v) if np.isfinite(v) else None} for d,v in zip(pd.period_range('2001-01',periods=len(values),freq='M'),values)]


def test_sampling_is_inside_bounds_distinct_and_normalized():
    r=Region(name='Coimbatore',latitude=11.0168,longitude=76.9558,half_span=1)
    points=region_samples(r)
    assert len(points)==9
    assert len({(p['latitude'],p['longitude']) for p in points})==9
    assert sum(p['weight'] for p in points)==pytest.approx(1)
    assert all(abs(p['latitude']-r.latitude)<=1 and abs(p['longitude']-r.longitude)<=1 for p in points)
    assert all(p['latitude']/.5==round(p['latitude']/.5) and p['longitude']/.625==round(p['longitude']/.625) for p in points)


def test_small_region_does_not_duplicate_native_cells():
    r=Region(name='Small',latitude=11.0168,longitude=76.9558,half_span=.5)
    points=region_samples(r)
    assert 1<len(points)<9
    assert len(points)==len({(p['latitude'],p['longitude']) for p in points})


def test_invalid_bounds_years_and_nonfinite_coordinates_rejected():
    with pytest.raises(ValueError): Region(name='Pole',latitude=84,longitude=0,half_span=5)
    with pytest.raises(ValueError): Region(name='Date line',latitude=0,longitude=179,half_span=5)
    with pytest.raises(ValueError): Region(name='NaN',latitude=float('nan'),longitude=0)
    r=Region(name='Valid',latitude=0,longitude=0)
    with pytest.raises(ValueError): ComparisonRequest(a=r,b=r,start=2020,end=2010)


def test_aggregation_keeps_fixed_footprint_and_real_units():
    r=Region(name='Test',latitude=0,longitude=0)
    points=[{'latitude':0,'longitude':0,'weight':.25},{'latitude':.5,'longitude':.625,'weight':.75}]
    dates=pd.date_range('2020-01-01','2022-12-31').strftime('%Y%m%d')
    records=[]
    for temp in [10.,20.]:
        values={key:{d:temp if key!='PRECTOTCORR' else 1. for d in dates} for key in sorted(PARAMETERS)}
        records.append({'payload':{'header':{'fill_value':-999},'properties':{'parameter':values}},'source_url':'https://power.larc.nasa.gov/','retrieved_at':'2026-11-14T00:00:00Z'})
    records[1]['payload']['properties']['parameter']['PRECTOTCORR']['20200101']=-999
    a=aggregate_region(r,points,records,'T2M',2020,2022)
    assert a['annual'][0]['value']==pytest.approx(17.5)
    b=aggregate_region(r,points,records,'PRECTOTCORR',2020,2022)
    assert b['annual'][0]['value'] is None
    assert b['annual'][1]['value']==365
    assert b['analysis']['quality']['missing_days']==1


def coupled():
    rng=np.random.default_rng(19); n=360;lag=3
    source=rng.normal(0,1,n)
    target=rng.normal(0,.15,n)
    target[lag:]+=2*source[:-lag]
    season=5*np.sin(np.arange(n)*np.pi/6)
    return monthly(20+season+source+.003*np.arange(n)),monthly(15+season+target+.002*np.arange(n)),lag


def test_recovers_known_lagged_response_with_purged_temporal_validation():
    a,b,lag=coupled()
    result=cross_region_model(a,b,lag)
    assert result['status']=='supported',result['reason']
    assert result['coefficient']==pytest.approx(2,abs=.1)
    assert result['skill']>.9
    assert result['validation_months']>=36
    assert all(f['training_last_target']<f['test_first_origin'] for f in result['folds'])
    assert result['coefficient_interval'][0]>0
    assert result['scenario_reference']['target_date']=='2031-03'


def test_reverse_direction_does_not_inherit_forward_response():
    a,b,lag=coupled()
    result=cross_region_model(b,a,lag)
    assert result['status']=='withheld'
    assert result['skill'] is not None
    assert result['skill']<.05


def test_shared_trends_alone_do_not_establish_a_predictive_link():
    x=np.arange(300)
    a=monthly(10+.02*x+3*np.sin(x*np.pi/6))
    b=monthly(20+.03*x+4*np.sin(x*np.pi/6))
    result=cross_region_model(a,b,3)
    assert result['status']=='withheld'
    assert result['coefficient'] is None


def test_overlap_short_records_and_missing_pairs_withhold_predictions():
    a,b,lag=coupled()
    assert cross_region_model(a,b,lag,True)['status']=='withheld'
    assert cross_region_model(a[:100],b[:100],lag)['status']=='withheld'
    # A gap cannot be concealed by compressing the calendar or randomly shuffling rows.
    a[160]['value']=None
    result=cross_region_model(a,b,lag)
    assert result['status']=='withheld'
    assert 'Gaps' in result['reason']
    assert boxes_overlap(Region(name='A',latitude=0,longitude=0),Region(name='B',latitude=1,longitude=1))


def test_complete_comparison_identifies_opposite_trends_and_bounds_download_concurrency():
    from backend.regions import compare_regions
    active=maximum=0
    calls=[]
    async def loader(latitude,longitude,start,end):
        nonlocal active,maximum
        active+=1;maximum=max(active,maximum)
        await asyncio.sleep(0)
        calls.append((latitude,longitude))
        dates=pd.date_range(f'{start}-01-01',f'{end}-12-31')
        slope=.2 if latitude>0 else -.1
        values={day.strftime('%Y%m%d'):20+slope*(day.year-start) for day in dates}
        record={'payload':{'header':{'fill_value':-999},'properties':{'parameter':{key:values for key in sorted(PARAMETERS)}}},'source_url':'https://power.larc.nasa.gov/api/temporal/daily/point','retrieved_at':'2026-11-14T00:00:00Z'}
        active-=1
        return record,'cached'
    request=ComparisonRequest(a=Region(name='Rising',latitude=10,longitude=20),b=Region(name='Falling',latitude=-10,longitude=40),start=2020,end=2022)
    result=asyncio.run(compare_regions(request,loader))
    assert result['contrast']['opposite_directions']
    assert result['contrast']['slope_b_minus_a']==pytest.approx(-3)
    assert result['a']['trend']['slope']==pytest.approx(2)
    assert result['b']['trend']['slope']==pytest.approx(-1)
    assert maximum<=2
    assert len(calls)==len(set(calls))==18
    assert result['directions']['a_to_b']['status']=='withheld'
