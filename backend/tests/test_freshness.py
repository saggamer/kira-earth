from backend.science import PROVIDER_UNITS
import json
import os
from datetime import datetime, timezone
from unittest.mock import patch
import pytest
from backend.weather import latest_initialization, fetch_weather
from backend.main import validate_power


def test_cached_forecast_never_renews_latest_provider_check(tmp_path):
    pointer = tmp_path / 'aifs-latest.json'
    pointer.write_text(json.dumps({'run':'2026111400'}))
    (tmp_path / 'aifs-2026111400-006.json').write_text(json.dumps({'schema_version':2,'lead_hours':6}))
    original_time = pointer.stat().st_mtime
    with patch('ecmwf.opendata.Client.latest', side_effect=AssertionError('No check due yet')):
        result = fetch_weather(tmp_path, 6)
    assert result['latest_checked_at'] is not None
    assert pointer.stat().st_mtime == original_time


def test_expired_or_forced_pointer_checks_provider(tmp_path):
    pointer = tmp_path / 'aifs-latest.json'
    pointer.write_text(json.dumps({'run':'2026111300'}))
    os.utime(pointer, (0,0))
    latest = datetime(2026,11,14,tzinfo=timezone.utc)
    with patch('ecmwf.opendata.Client.latest',return_value=latest) as call:
        initialization, checked = latest_initialization(tmp_path,6)
        assert initialization == latest
        latest_initialization(tmp_path,6)
        assert call.call_count == 1
        latest_initialization(tmp_path,6,refresh=True)
        assert call.call_count == 2
    assert json.loads(pointer.read_text())['run'] == '2026111400'


def test_failed_latest_check_does_not_renew_old_pointer(tmp_path):
    pointer = tmp_path / 'aifs-latest.json'
    pointer.write_text(json.dumps({'run':'2026111300'}))
    os.utime(pointer, (0,0))
    with patch('ecmwf.opendata.Client.latest',side_effect=OSError('Offline')):
        with pytest.raises(OSError): latest_initialization(tmp_path,6)
    assert pointer.stat().st_mtime == 0


def test_power_rejects_wrong_coordinates_time_units_and_dates():
    from copy import deepcopy
    params={'longitude':77.,'latitude':11.,'start':'20200101','end':'20201231'}
    payload={'geometry':{'coordinates':[77.,11.]},'header':{'time_standard':'UTC','start':'20200101','end':'20201231'},
             'properties':{'parameter':{name:{'20200101':1.} for name in PROVIDER_UNITS}},
             'parameters':{name:{'units':unit} for name,unit in PROVIDER_UNITS.items()}}
    validate_power(payload,params)
    for section, key, value in [('geometry','coordinates',[11.,77.]),('header','time_standard','LST'),('header','end','20211231')]:
        wrong=deepcopy(payload);wrong[section][key]=value
        with pytest.raises(ValueError): validate_power(wrong,params)
    wrong=deepcopy(payload);wrong['parameters']['T2M']['units']='K'
    with pytest.raises(ValueError): validate_power(wrong,params)
    wrong=deepcopy(payload);wrong['properties']['parameter']['T2M']={'20190101':1.}
    with pytest.raises(ValueError): validate_power(wrong,params)


def test_imagery_catalog_requires_all_layers_and_valid_time_dimensions():
    from backend.imagery import parse_catalog, LAYERS
    layers=''.join(f'<Layer><ows:Identifier>{name}</ows:Identifier><Dimension><ows:Identifier>Time</ows:Identifier><Default>2026-11-14</Default><Value>2020-01-01/2026-11-14/P1D</Value></Dimension></Layer>' for name in LAYERS)
    xml=f'<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1"><Contents>{layers}</Contents></Capabilities>'
    assert set(parse_catalog(xml)) == LAYERS
    with pytest.raises(ValueError): parse_catalog(xml.replace('2026-11-14','not-a-date'))
    with pytest.raises(ValueError): parse_catalog(xml.replace(next(iter(LAYERS)),'missing-layer'))
