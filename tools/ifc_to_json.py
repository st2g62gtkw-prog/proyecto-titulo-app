"""
Convierte el modelo IFC del Edificio E (Revit -> IfcOpenShell) en los datos que usa la app.

Uso:
    pip install ifcopenshell numpy
    python tools/ifc_to_json.py ruta/Edificio-E.ifc public/data

Genera:
    edificio-e.json        Polígonos de losas y muros por piso (la app los extruye y anima).
    edificio-e-detalle.bin Mallas trianguladas de ventanas, vidrios, barandas y puertas
                           (Float32, coordenadas de la app), indexadas desde el JSON.

Ejes: la app usa Y hacia arriba. Planta IFC (X, Y) -> app (x, -z). La cota 0 de la app
es la cara superior del radier (NPT 1P).
"""
import json
import struct
import sys
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.placement as uplace
import numpy as np

# Muros con espesor medio sobre este valor se tratan como hormigón armado e=20.
# Bajo este valor son tabiquería / fachada liviana (se instalan en terminaciones).
ESPESOR_HA = 0.15


def profile_loops(solid):
    p = solid.SweptArea
    loops = []
    if p.is_a("IfcArbitraryClosedProfileDef") or p.is_a("IfcArbitraryProfileDefWithVoids"):
        loops.append([q.Coordinates for q in p.OuterCurve.Points])
        if p.is_a("IfcArbitraryProfileDefWithVoids"):
            for c in p.InnerCurves:
                loops.append([q.Coordinates for q in c.Points])
    else:
        raise ValueError(f"perfil no soportado: {p.is_a()}")
    return loops


def to_world(e, solid, loops):
    m = uplace.get_local_placement(e.ObjectPlacement)
    mp = uplace.get_axis2placement(solid.Position)
    mm = m @ mp
    out = []
    for loop in loops:
        pts = np.array([[c[0], c[1], 0.0, 1.0] for c in loop])
        w = (mm @ pts.T).T[:, :3]
        out.append(w)
    z0 = float(out[0][0][2])
    return out, z0, z0 + float(solid.Depth)


def clean(loop):
    pts = [tuple(p[:2]) for p in loop]
    if len(pts) > 1 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    res = []
    for p in pts:
        if not res or np.hypot(p[0] - res[-1][0], p[1] - res[-1][1]) > 1e-4:
            res.append(p)
    return res


def area(P):
    P = np.asarray(P)
    x, y = P[:, 0], P[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def perim(P):
    P = np.asarray(P)
    return float(np.sum(np.linalg.norm(np.roll(P, -1, axis=0) - P, axis=1)))


def storey_of(e):
    for r in e.ContainedInStructure or []:
        return r.RelatingStructure
    return None


def main(ifc_path, out_dir):
    f = ifcopenshell.open(ifc_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    storeys = sorted(f.by_type("IfcBuildingStorey"), key=lambda s: s.Elevation)
    z_ref = storeys[0].Elevation  # cara superior del radier = 0 en la app

    def P(x, y):  # planta IFC -> (x, z) app, redondeado a mm
        return [round(x, 3), round(-y, 3)]

    levels = []
    for s in storeys:
        lv = {"name": s.Name, "elev": round(s.Elevation - z_ref, 3), "slab": None, "walls": []}
        for rel in s.ContainsElements:
            for e in rel.RelatedElements:
                if not (e.is_a("IfcSlab") or e.is_a("IfcWall")):
                    continue
                solid = [it for r in e.Representation.Representations for it in r.Items
                         if it.is_a("IfcExtrudedAreaSolid")][0]
                loops, z0, z1 = to_world(e, solid, profile_loops(solid))
                loops = [clean(l) for l in loops]
                if e.is_a("IfcSlab"):
                    outer = loops[0]
                    if area(outer) < 0:
                        outer = outer[::-1]
                    holes = []
                    for h in loops[1:]:
                        if area(h) > 0:
                            h = h[::-1]
                        holes.append([P(*p) for p in h])
                    lv["slab"] = {
                        "name": e.Name,
                        "y0": round(z0 - z_ref, 3),
                        "y1": round(z1 - z_ref, 3),
                        "outer": [P(*p) for p in outer],
                        "holes": holes,
                        "area": round(abs(area(outer)) - sum(abs(area(h)) for h in loops[1:]), 2),
                    }
                else:
                    poly = loops[0]
                    if area(poly) < 0:
                        poly = poly[::-1]
                    a = abs(area(poly))
                    t = 2 * a / perim(poly)
                    cat = e.Name.split(" ")[0].lower()  # fachada | tabique | fondo
                    lv["walls"].append({
                        "id": e.GlobalId,
                        "name": e.Name,
                        "cat": cat,
                        "ha": bool(t >= ESPESOR_HA and cat != "fondo"),
                        "t": round(t, 3),
                        "y0": round(z0 - z_ref, 3),
                        "y1": round(z1 - z_ref, 3),
                        "poly": [P(*p) for p in poly],
                    })
        levels.append(lv)

    # Mallas de detalle (ventanas, vidrios, barandas, puertas) trianguladas por IfcOpenShell.
    st = ifcopenshell.geom.settings()
    st.set(st.USE_WORLD_COORDS, True)
    it = ifcopenshell.geom.iterator(st, f, 4, include=f.by_type("IfcWindow") + f.by_type("IfcPlate")
                                    + f.by_type("IfcRailing") + f.by_type("IfcDoor"))
    groups = {}
    if it.initialize():
        while True:
            sh = it.get()
            e = f.by_id(sh.id)
            s = storey_of(e)
            v = np.array(sh.geometry.verts, dtype=np.float64).reshape(-1, 3)
            fa = np.array(sh.geometry.faces, dtype=np.int64).reshape(-1, 3)
            tri = v[fa].reshape(-1, 3)
            app = np.stack([tri[:, 0], tri[:, 2] - z_ref, -tri[:, 1]], axis=1).astype(np.float32)
            key = (s.Name if s else "?", e.is_a()[3:].lower())
            groups.setdefault(key, []).append(app)
            if not it.next():
                break

    blob = bytearray()
    index = []
    for (lvl, kind), arrs in sorted(groups.items()):
        a = np.concatenate(arrs).astype("<f4")
        index.append({"level": lvl, "kind": kind, "offset": len(blob), "count": int(a.shape[0])})
        blob += a.tobytes()
    (out_dir / "edificio-e-detalle.bin").write_bytes(bytes(blob))

    terrain = f.by_type("IfcGeographicElement")[0]
    tsolid = [it for r in terrain.Representation.Representations for it in r.Items
              if it.is_a("IfcExtrudedAreaSolid")][0]
    tl, tz0, tz1 = to_world(terrain, tsolid, profile_loops(tsolid))

    data = {
        "proyecto": "Condominio Espacio Las Lomas – Las Tablas",
        "edificio": "Edificio E",
        "fuente": Path(ifc_path).name,
        "espesorHA": ESPESOR_HA,
        "levels": levels,
        "terrain": {"y": round(tz1 - z_ref, 3), "outer": [P(*p) for p in clean(tl[0])]},
        "detail": {"file": "edificio-e-detalle.bin", "groups": index},
    }
    (out_dir / "edificio-e.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    nha = sum(1 for l in levels for w in l["walls"] if w["ha"])
    print(f"pisos={len(levels)} muros={sum(len(l['walls']) for l in levels)} HA={nha} "
          f"detalle={len(blob)/1e6:.2f} MB grupos={len(index)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
