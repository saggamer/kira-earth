import numpy as np
from backend.weather import pressure_geometry

def test_pressure_contours_use_real_grid_values():
    x=np.arange(-20,21,dtype=float); y=np.arange(20,-21,-1,dtype=float)
    pressure=1000+np.broadcast_to(x,(len(y),len(x)))
    contours,centers=pressure_geometry(x,y,pressure)
    line=next(c for c in contours if c['value']==1004)
    assert all(abs(p[0]-4)<.001 for p in line['coordinates'])
    assert all(c['value']%4==0 for c in contours)

def test_constant_pressure_never_invents_centers():
    x=np.arange(-20,21,dtype=float); y=np.arange(20,-21,-1,dtype=float)
    contours,centers=pressure_geometry(x,y,np.full((41,41),1012.))
    assert contours==[]
    assert centers==[]
