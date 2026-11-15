"""Sampled regional climate trends and validated, non-causal cross-region scenarios."""
import asyncio
from datetime import date, datetime, timezone
from typing import Literal
import numpy as np
import pandas as pd
from pydantic import BaseModel, Field, model_validator
from .science import analyze, PARAMETERS, VALID_RANGE
from .analytics import block_sample

Parameter = Literal['T2M', 'T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'RH2M', 'WS10M', 'PS', 'GWETROOT']

class Region(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    latitude: float = Field(ge=-84, le=84, allow_inf_nan=False)
    longitude: float = Field(ge=-179.5, le=179.5, allow_inf_nan=False)
    half_span: float = Field(default=1, ge=.5, le=10, allow_inf_nan=False)

    @model_validator(mode='after')
    def valid_bounds(self):
        if abs(self.latitude) + self.half_span > 85 or abs(self.longitude) + self.half_span > 180:
            raise ValueError('Keep each region within 85° latitude and on one side of the date line.')
        return self

class ComparisonRequest(BaseModel):
    a: Region
    b: Region
    parameter_a: Parameter = 'T2M'
    parameter_b: Parameter = 'T2M'
    start: int = Field(default=2001, ge=1981)
    end: int = Field(default=2024, ge=1981)
    lag_months: int = Field(default=3, ge=1, le=12)

    @model_validator(mode='after')
    def valid_years(self):
        if self.start > self.end or self.end >= date.today().year or self.end-self.start > 44:
            raise ValueError('Use at most 45 ordered, complete historical years, ending before the current year.')
        return self


def region_samples(region: Region):
    """Up to 3×3 distinct native meteorology grid centers inside a rectangle."""
    s=region.half_span
    lat=np.arange(np.ceil((region.latitude-s)*2), np.floor((region.latitude+s)*2)+1)/2
    lon=np.arange(np.ceil((region.longitude-s)/.625), np.floor((region.longitude+s)/.625)+1)*.625
    lat=lat[np.unique(np.rint(np.linspace(0,len(lat)-1,min(3,len(lat)))).astype(int))]
    lon=lon[np.unique(np.rint(np.linspace(0,len(lon)-1,min(3,len(lon)))).astype(int))]
    points=[{'latitude':float(y),'longitude':float(x),'weight':float(np.cos(np.radians(y)))} for y in lat for x in lon]
    total=sum(p['weight'] for p in points)
    for p in points: p['weight']/=total
    return points


def aggregate_region(region, points, records, parameter, start, end):
    index=pd.date_range(f'{start}-01-01',f'{end}-12-31',freq='D')
    dates=index.strftime('%Y%m%d')
    combined={}
    for key in PARAMETERS:
        arrays=[]
        for record in records:
            payload=record['payload']
            values=payload['properties']['parameter'][key]
            a=np.array([values.get(day,np.nan) for day in dates],dtype=float)
            a[(a==payload.get('header',{}).get('fill_value',-999)) | ~np.isfinite(a)]=np.nan
            low,high=VALID_RANGE.get(key,(None,None))
            if low is not None: a[a<low]=np.nan
            if high is not None: a[a>high]=np.nan
            arrays.append(a)
        matrix=np.array(arrays)
        valid=np.isfinite(matrix).all(axis=0)
        average=np.sum(np.nan_to_num(matrix)*np.array([p['weight'] for p in points])[:,None],axis=0)
        combined[key]={str(day):float(value) if ok else -999 for day,value,ok in zip(dates,average,valid)}
    derived={'header':{'fill_value':-999},'properties':{'parameter':combined}}
    result=analyze(derived,parameter,start,end)
    s=region.half_span
    result.update({'region':region.model_dump(),'bounds':{'west':region.longitude-s,'east':region.longitude+s,'south':region.latitude-s,'north':region.latitude+s},
                   'samples':points,'sampling':'Cosine-latitude-weighted mean of up to 9 distinct 0.5°×0.625° grid centers inside the box. A sampled estimate, not a full polygon mean.',
                   'missing_policy':'Every sampled cell must be valid for a day; the spatial footprint never changes. No gap filling.',
                   'provenance':[{'latitude':p['latitude'],'longitude':p['longitude'],'source_url':r['source_url'],'retrieved_at':r['retrieved_at']} for p,r in zip(points,records)]})
    return result


def design(origins, target, source, lag, include_source=True):
    # All seasonal, time and autoregressive coefficients are fitted only on the training fold.
    months=(origins+lag)%12
    columns=[np.ones(len(origins)), (origins+lag)/12, target[origins]]
    columns.extend((months==month).astype(float) for month in range(1,12))
    if include_source: columns.append(source[origins])
    return np.column_stack(columns)


def fit(x,y):
    coefficient,_,rank,_=np.linalg.lstsq(x,y,rcond=None)
    if rank < x.shape[1]: return None
    return coefficient


def cross_region_model(source_monthly, target_monthly, lag, overlapping=False):
    result={'status':'withheld','reason':'At least 15 years of usable paired monthly data are required.','lag_months':lag,
            'coefficient':None,'coefficient_interval':None,'skill':None,'rmse':None,'baseline_rmse':None,'validation_months':0,
            'validation':[],'folds':[],'scenario_reference':None,'supported_change':None,
            'method':'Direct lagged regression: future target ~ calendar-month effects + time + present target + present source. Baseline excludes the source. Expanding yearly validation folds use only targets observed before each test origin.',
            'limitation':'Predictive association, not causal attribution or a long-term climate projection. Lag is user-chosen; no automated lag search or relationship significance claim.'}
    if overlapping:
        result['reason']='These regions overlap. Shared geography can create an artificial relationship; cross-region prediction is withheld.'
        return result
    s=np.array([m['value'] if m['value'] is not None else np.nan for m in source_monthly])
    t=np.array([m['value'] if m['value'] is not None else np.nan for m in target_monthly])
    n=len(s)
    if n!=len(t) or [m['date'] for m in source_monthly]!=[m['date'] for m in target_monthly]:
        raise ValueError('Regional monthly calendars do not match.')
    origins=np.arange(max(0,n-lag))
    origins=origins[np.isfinite(s[origins]) & np.isfinite(t[origins]) & np.isfinite(t[origins+lag])]
    result['paired_months']=len(origins)
    if len(origins)<180: return result
    x=design(origins,t,s,lag); y=t[origins+lag]
    beta=fit(x,y); base=fit(x[:,:-1],y)
    if beta is None or base is None:
        result['reason']='Source variability cannot be separated from seasonality, time or the target’s own history.'
        return result
    residual_source=x[:,-1]-x[:,:-1]@np.linalg.lstsq(x[:,:-1],x[:,-1],rcond=None)[0]
    source_scale=float(np.std(residual_source))
    if source_scale<1e-6:
        result['reason']='Insufficient independent source variability after accounting for the target and seasonal/time effects.'
        return result
    # Hold out the last five origin-years; purge the forecast horizon from each training boundary.
    first_test=max(120, (n//12-5)*12)
    validation=[];folds=[]
    for begin in range(first_test,n-lag,12):
        train=origins[origins+lag < begin]
        test=origins[(origins>=begin)&(origins<begin+12)]
        if len(train)<120 or len(test)<6: continue
        xt=design(train,t,s,lag); yt=t[train+lag]
        bf=fit(xt,yt);bb=fit(xt[:,:-1],yt)
        if bf is None or bb is None: continue
        xv=design(test,t,s,lag)
        full=xv@bf;baseline=xv[:,:-1]@bb;actual=t[test+lag]
        mse=float(np.mean((actual-full)**2));base_mse=float(np.mean((actual-baseline)**2))
        folds.append({'training_last_target':target_monthly[int(train[-1]+lag)]['date'],'test_first_origin':source_monthly[int(test[0])]['date'],
                      'months':len(test),'skill':1-mse/base_mse if base_mse>1e-12 else None})
        for i,p,b,a in zip(test,full,baseline,actual):
            validation.append({'origin':source_monthly[int(i)]['date'],'date':target_monthly[int(i+lag)]['date'],'actual':float(a),'prediction':float(p),'baseline':float(b)})
    result.update({'validation':validation,'folds':folds,'validation_months':len(validation)})
    if len(validation)<36 or len(folds)<3:
        result['reason']='Fewer than 36 out-of-sample months or three validation folds; prediction is withheld.'
        return result
    errors=np.array([v['actual']-v['prediction'] for v in validation]);base_errors=np.array([v['actual']-v['baseline'] for v in validation])
    mse=float(np.mean(errors**2));base_mse=float(np.mean(base_errors**2))
    skill=1-mse/base_mse if base_mse>1e-12 else None
    result.update({'skill':skill,'rmse':float(np.sqrt(mse)),'baseline_rmse':float(np.sqrt(base_mse)),'coefficient':float(beta[-1])})
    # Fixed-design residual blocks keep the temporal sequence; no shuffle-based train/test split.
    # Require a consecutive training sequence for this uncertainty calculation.
    if not np.all(np.diff(origins)==1):
        result['reason']='Gaps in the paired monthly sequence prevent the block-based uncertainty calculation.'
        return result
    rng=np.random.default_rng(7301)
    residual=y-x@beta;residual-=residual.mean()
    block=max(12,lag+1,int(np.ceil(len(origins)**(1/3))))
    inverse=np.linalg.pinv(x)
    bootstrap=np.array([(inverse@(x@beta+block_sample(residual,rng,block)))[-1] for _ in range(499)])
    low,high=np.quantile(bootstrap,[.025,.975])
    result.update({'coefficient_interval':[float(low),float(high)],'bootstrap':{'iterations':499,'block_months':block,'seed':7301},
                   'supported_change':[-source_scale,source_scale]})
    # Last origin has real source and target values. Its target date may be historical, never labeled live.
    last=np.flatnonzero(np.isfinite(s)&np.isfinite(t))[-1]
    if last==n-1:
        reference=float((design(np.array([last]),t,s,lag)@beta)[0])
        date_out=str(pd.Period(source_monthly[last]['date'],freq='M')+lag)
        result['scenario_reference']={'origin':source_monthly[last]['date'],'target_date':date_out,'prediction':reference,
                                      'error_interval':np.quantile(errors,[.025,.975]).tolist(),
                                      'limitation':'Approximate historical-scenario range from out-of-sample errors; nominal coverage is not guaranteed. It is not a current weather forecast.'}
    stable=sum(f['skill'] is not None and f['skill']>0 for f in folds)/len(folds)
    if skill is None or skill<=.05 or stable<.6:
        result['reason']='The source region did not consistently improve held-out predictions by at least 5% in mean-squared error over the target-only baseline.'
    elif low<=0<=high:
        result['reason']='The exploratory source-response interval includes zero; response estimates are withheld.'
    else:
        result.update({'status':'supported','reason':'Exploratory response supported by this historical validation: >5% error reduction, positive skill in ≥60% of yearly folds and a block interval excluding zero.'})
    return result


def boxes_overlap(a,b):
    return abs(a.latitude-b.latitude)<a.half_span+b.half_span and abs(a.longitude-b.longitude)<a.half_span+b.half_span


async def compare_regions(request: ComparisonRequest, loader):
    samples=[region_samples(request.a),region_samples(request.b)]
    points={(p['latitude'],p['longitude']) for group in samples for p in group}
    semaphore=asyncio.Semaphore(2)
    async def load(point):
        async with semaphore:
            cached,_=await loader(point[0],point[1],request.start,request.end)
            return point,cached
    retrieved=dict(await asyncio.gather(*(load(p) for p in sorted(points))))
    def calculate():
        regions=[]
        for r,points,parameter in zip([request.a,request.b],samples,[request.parameter_a,request.parameter_b]):
            records=[retrieved[p['latitude'],p['longitude']] for p in points]
            regions.append(aggregate_region(r,points,records,parameter,request.start,request.end))
        a,b=regions
        overlap=boxes_overlap(request.a,request.b) or bool({(p['latitude'],p['longitude']) for p in samples[0]} & {(p['latitude'],p['longitude']) for p in samples[1]})
        ta,tb=a['trend'],b['trend']
        return {'request':request.model_dump(),'checked_at':datetime.now(timezone.utc).isoformat(),'a':a,'b':b,
                'contrast':{'slope_b_minus_a':tb['slope']-ta['slope'] if request.parameter_a==request.parameter_b and ta and tb else None,
                            'opposite_directions':bool(ta and tb and ta['slope']*tb['slope']<0),
                            'limitation':'Difference of descriptive Sen slopes, not a test of a regional difference. Pointwise significance is not corrected across regions.'},
                'directions':{'a_to_b':cross_region_model(a['monthly'],b['monthly'],request.lag_months,overlap),
                              'b_to_a':cross_region_model(b['monthly'],a['monthly'],request.lag_months,overlap)},
                'limitations':['Regional values are weighted grid samples, not full-area averages or station observations. Land and ocean cells within each box are both included.',
                               'Cross-region statistical association does not establish physical transport, causality, damage, crop yield, health impacts or a future climate projection.',
                               'Changing the lag or repeatedly trying region pairs is exploratory; no multiple-comparison significance claim is made.']}
    return await asyncio.to_thread(calculate)
