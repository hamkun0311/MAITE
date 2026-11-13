"""Optional independent CAD validation. This script is not an application server.

Setup: python -m venv .venv
       .venv/Scripts/python -m pip install cadquery-ocp-novtk==7.9.3.1.1
Run:   .venv/Scripts/python scripts/verify-step.py .verification/mounting-plate.step
"""
import json
import math
import sys
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.TopAbs import TopAbs_SOLID, TopAbs_FACE
from OCP.TopExp import TopExp_Explorer
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.TopoDS import TopoDS

reader = STEPControl_Reader()
assert reader.ReadFile(sys.argv[1]) == IFSelect_RetDone, "STEP import failed"
assert reader.TransferRoots() == 1, "Expected one root"
shape = reader.OneShape()
assert BRepCheck_Analyzer(shape).IsValid(), "Invalid B-Rep topology"
explorer = TopExp_Explorer(shape, TopAbs_SOLID)
solids = 0
while explorer.More():
    solids += 1
    explorer.Next()
assert solids == 1, f"Expected one solid, found {solids}"
bounds = Bnd_Box()
BRepBndLib.AddOptimal_s(shape, bounds, False, False)
x0, y0, z0, x1, y1, z1 = bounds.Get()
dimensions = [x1-x0, y1-y0, z1-z0]
assert all(abs(a-b) < 0.001 for a, b in zip(dimensions, [100, 60, 5]))
props = GProp_GProps()
BRepGProp.VolumeProperties_s(shape, props)
expected_volume = 30000 - 4 * math.pi * 3**2 * 5
assert abs(props.Mass() - expected_volume) < 0.01
faces = TopExp_Explorer(shape, TopAbs_FACE)
cylinders = []
while faces.More():
    surface = BRepAdaptor_Surface(TopoDS.Face_s(faces.Current()))
    if surface.GetType() == GeomAbs_Cylinder:
        cylinder = surface.Cylinder()
        assert abs(cylinder.Radius() - 3) < 1e-6
        origin = cylinder.Location()
        cylinders.append([origin.X(), origin.Y(), cylinder.Radius()])
    faces.Next()
assert len(cylinders) == 4
assert sorted([round(x), round(y)] for x, y, _ in cylinders) == [[-40, -20], [-40, 20], [40, -20], [40, 20]]
print(json.dumps({"reader": "CadQuery OCP / OCCT 7.9.3", "valid": True, "solids": solids,
                  "dimensions_mm": dimensions, "volume_mm3": props.Mass(), "holes": cylinders}, indent=2))
