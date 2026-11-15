"""NASA's own dated layer catalog; availability is not pixel-level completeness."""
from datetime import datetime, timezone
from pathlib import Path
import json
import time
import xml.etree.ElementTree as ET

CATALOG_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml'
LAYERS = {'MODIS_Terra_Land_Surface_Temp_Day','IMERG_Precipitation_Rate','MODIS_Terra_CorrectedReflectance_TrueColor'}

def parse_catalog(xml: str):
    root = ET.fromstring(xml)
    ns={'w':'http://www.opengis.net/wmts/1.0','o':'http://www.opengis.net/ows/1.1'}
    found={}
    for layer in root.findall('.//w:Contents/w:Layer',ns):
        name=layer.findtext('o:Identifier',namespaces=ns)
        if name not in LAYERS: continue
        for dimension in layer.findall('w:Dimension',ns):
            if dimension.findtext('o:Identifier',namespaces=ns) != 'Time': continue
            default=dimension.findtext('w:Default',namespaces=ns)
            intervals=[node.text for node in dimension.findall('w:Value',ns)]
            if not default or not intervals: raise ValueError('Incomplete NASA time dimension')
            datetime.fromisoformat(default.replace('Z','+00:00'))
            for interval in intervals:
                parts=interval.split('/')
                for day in parts[:2]: datetime.fromisoformat(day.replace('Z','+00:00'))
            found[name]={'default':default,'intervals':intervals}
    if set(found) != LAYERS: raise ValueError('NASA catalog is missing required layers')
    return found

async def fetch_catalog(cache: Path, client):
    file=cache/'gibs-catalog.json'
    if file.exists() and time.time()-file.stat().st_mtime < 600:
        return json.loads(file.read_text())
    response=await client.get(CATALOG_URL)
    response.raise_for_status()
    output={'layers':parse_catalog(response.text),'checked_at':datetime.now(timezone.utc).isoformat(),'source_url':CATALOG_URL}
    temporary=file.with_suffix('.tmp')
    temporary.write_text(json.dumps(output))
    temporary.replace(file)
    return output
