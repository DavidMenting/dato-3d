"""Pass 1 inspection of a CAD FBX (no assumptions). Headless Blender:
  blender -b --factory-startup -P scripts/inspect.py -- cad/Dato+DRUM+1.0.fbx drum
Writes cad/out/<product>-parts.json/.tsv, <product>-top.png, -34.png, -top-q1..q4.png
(unlabelled) and <product>-labels-*.json. Then run scripts/label_sheet.py to draw numbers."""
import sys, os, json, math, random
from collections import Counter
import bpy, numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index("--") + 1:]
FBX, PRODUCT = argv[0], argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(FBX)), "out")
os.makedirs(OUT, exist_ok=True)
WIDTH = 2400
SAMPLES = 300  # vertices sampled per part for visibility

# ---- import ---------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
if hasattr(bpy.ops.wm, "fbx_import"):
    bpy.ops.wm.fbx_import(filepath=os.path.abspath(FBX))
else:
    bpy.ops.import_scene.fbx(filepath=os.path.abspath(FBX))
scene = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()

def chain(o):
    names = []
    p = o.parent
    while p:
        names.append(p.name)
        p = p.parent
    return names[::-1]

meshes = [o for o in scene.objects if o.type == "MESH"]
meshes.sort(key=lambda o: "/".join(chain(o) + [o.name]))

# ---- geometry (world, Blender units) ----------------------------------------
geo = []  # per part: dict(verts Nx3 world, tris Mx3 local index)
for o in meshes:
    eo = o.evaluated_get(dg)
    me = eo.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    mw = np.array(eo.matrix_world)
    w = co @ mw[:3, :3].T + mw[:3, 3]
    me.calc_loop_triangles()
    tr = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("vertices", tr)
    geo.append(dict(v=w, t=tr.reshape(-1, 3)))
    eo.to_mesh_clear()

allv = np.concatenate([g["v"] for g in geo if len(g["v"])])
bmin, bmax = allv.min(0), allv.max(0)
ext = bmax - bmin
# unit scale: Blender units -> mm, pick the candidate that makes the largest
# horizontal dimension plausible for a ~250-300 mm device
cands = {1000.0: "m", 10.0: "cm", 1.0: "mm"}
horiz = sorted(ext)[1:]
unit_scale = None
for s in cands:
    if 150 <= max(horiz) * s <= 450:
        unit_scale = s
        break
if unit_scale is None:
    unit_scale = 1000.0
    print("WARNING: no plausible unit scale found, assuming metres")
up = int(np.argmin(ext))
overall = {"min": (bmin * unit_scale).round(2).tolist(), "max": (bmax * unit_scale).round(2).tolist(),
           "size": (ext * unit_scale).round(2).tolist()}

# ---- materials -------------------------------------------------------------
def mat_color(m):
    if m is None:
        return None
    c = None
    if m.use_nodes and m.node_tree:
        for nd in m.node_tree.nodes:
            if nd.type == "BSDF_PRINCIPLED":
                inp = nd.inputs["Base Color"]
                if not inp.is_linked:
                    c = tuple(inp.default_value[:3])
                break
    if c is None:
        c = tuple(m.diffuse_color[:3])
    return c

def to_hex(c):
    # linear -> sRGB for display hex
    def f(x):
        x = max(0.0, min(1.0, x))
        return 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
    return "#%02x%02x%02x" % tuple(round(f(x) * 255) for x in c)

parts = []
for n, (o, g) in enumerate(zip(meshes, geo)):
    v = g["v"]
    mn, mx = (v.min(0), v.max(0)) if len(v) else (np.zeros(3), np.zeros(3))
    mats = []
    for slot in o.material_slots:
        c = mat_color(slot.material)
        if slot.material:
            mats.append({"name": slot.material.name, "rgb": [round(x, 4) for x in c], "hex": to_hex(c)})
    parts.append({
        "n": n, "name": o.name, "parent": "/".join(chain(o)),
        "bbox_min_mm": (mn * unit_scale).round(2).tolist(), "bbox_max_mm": (mx * unit_scale).round(2).tolist(),
        "size_mm": ((mx - mn) * unit_scale).round(2).tolist(),
        "centroid_mm": (((mx + mn) / 2) * unit_scale).round(2).tolist(),
        "verts": len(v), "tris": len(g["t"]), "materials": mats,
        "hidden": bool(o.hide_viewport or o.hide_render or o.hide_get()),
        "mesh_data": o.data.name,
    })

json.dump({"unit_scale": unit_scale, "unit_scale_note": f"Blender units x {unit_scale:g} = mm (source unit {cands[unit_scale]})",
           "overall_bbox_mm": overall, "up_axis": "XYZ"[up], "parts": parts},
          open(f"{OUT}/{PRODUCT}-parts.json", "w"), indent=1)

with open(f"{OUT}/{PRODUCT}-parts.tsv", "w") as f:
    f.write("n\tname\tparent(last2)\tsize_xyz_mm\tcentre_xyz_mm\tverts\thex\thidden\n")
    for p in parts:
        par = "/".join(p["parent"].split("/")[-2:]) if p["parent"] else ""
        hx = ",".join(m["hex"] for m in p["materials"]) or "-"
        f.write("\t".join([str(p["n"]), p["name"], par,
                           " ".join(f"{x:.1f}" for x in p["size_mm"]),
                           " ".join(f"{x:.1f}" for x in p["centroid_mm"]),
                           str(p["verts"]), hx, "H" if p["hidden"] else ""]) + "\n")

# ---- summary ---------------------------------------------------------------
print("\n=== SUMMARY ===")
print("objects (meshes):", len(parts), " unique mesh data:", len({p["mesh_data"] for p in parts}))
print("unit scale: x%g -> mm; up axis: %s; overall size mm: %s" % (unit_scale, "XYZ"[up], overall["size"]))
print("hidden:", sum(p["hidden"] for p in parts))
top = Counter()
for p in parts:
    top[p["parent"].split("/")[0] if p["parent"] else "(root) " + p["name"]] += 1
print("top-level nodes (mesh descendants):")
for k, v in top.most_common(40):
    print(f"  {v:5d}  {k}")
print("  roots total:", len(top))
hist = Counter(m["hex"] for p in parts for m in p["materials"][:1])
print("colour histogram (first material):", dict(hist.most_common(40)))
print("parts without material:", sum(1 for p in parts if not p["materials"]))

# ---- ray-cast structure ----------------------------------------------------
offs, vs, ts, owner = 0, [], [], []
for p, g in zip(parts, geo):
    if p["hidden"] or not len(g["t"]):
        continue
    vs.append(g["v"]); ts.append(g["t"] + offs); owner.append(np.full(len(g["t"]), p["n"]))
    offs += len(g["v"])
V = np.concatenate(vs); T = np.concatenate(ts); OWN = np.concatenate(owner)
bvh = BVHTree.FromPolygons([tuple(x) for x in V.tolist()], [tuple(x) for x in T.tolist()])

# ---- render ----------------------------------------------------------------
# Workbench/EEVEE need a GPU (none in the sandbox) -> Cycles CPU with flat emission
# materials (one per colour) + Freestyle outlines.
flat = {}
def flat_mat(c):
    key = tuple(round(x, 4) for x in c)
    if key not in flat:
        m = bpy.data.materials.new("flat")
        m.use_nodes = True
        nt = m.node_tree; nt.nodes.clear()
        em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (*c, 1.0)
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(em.outputs[0], out.inputs[0])
        flat[key] = m
    return flat[key]
for o, p in zip(meshes, parts):
    cols = [mat_color(s_.material) for s_ in o.material_slots]
    o.data.materials.clear()
    for c in cols:
        o.data.materials.append(flat_mat(c if c else (0.5, 0.5, 0.5)))
    if not cols:
        o.data.materials.append(flat_mat((0.5, 0.5, 0.5)))
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"; scene.cycles.samples = 8; scene.cycles.use_denoising = False
scene.view_settings.view_transform = "Standard"
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w"); scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.7, 0.7, 0.7, 1)
scene.render.use_freestyle = True
vl = scene.view_layers[0]; vl.use_freestyle = True
ls = vl.freestyle_settings.linesets[0] if vl.freestyle_settings.linesets else vl.freestyle_settings.linesets.new("l")
ls.linestyle = ls.linestyle or bpy.data.linestyles.new('ls')
ls.linestyle.thickness = 1.6; ls.linestyle.color = (0, 0, 0)
ls.select_silhouette = True; ls.select_border = True; ls.select_crease = True
vl.freestyle_settings.crease_angle = math.radians(35)
scene.render.image_settings.file_format = "PNG"
cam_data = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam); scene.camera = cam

centre = Vector(((bmin + bmax) / 2).tolist())
upv = Vector([1.0 if i == up else 0.0 for i in range(3)])
hint = Vector((0, 1, 0)) if up == 2 else Vector((0, 0, 1))  # image "up" for the top view
right = hint.cross(upv).normalized() * -1  # placeholder, recomputed below
d_top = -upv

def look(loc, target, hintv):
    cam.location = loc
    cam.rotation_euler = (target - loc).to_track_quat("-Z", "Y").to_euler() if hintv is None else \
        (target - loc).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()

def set_camera(kind, loc, target, ortho_scale=None, hintv=None):
    cam_data.type = "ORTHO" if kind == "ortho" else "PERSP"
    if ortho_scale: cam_data.ortho_scale = ortho_scale
    cam_data.clip_start = 0.001 * 10 / unit_scale * 100; cam_data.clip_end = 1e4
    cam.location = loc
    d = (target - loc).normalized()
    # build rotation: camera -Z = d, camera Y ~ hint
    z = -d; x = hintv.cross(z).normalized(); y = z.cross(x)
    cam.matrix_world = Matrix(((x.x, y.x, z.x, loc.x), (x.y, y.y, z.y, loc.y), (x.z, y.z, z.z, loc.z), (0, 0, 0, 1)))
    bpy.context.view_layer.update()

def sheet(name, h, label_filter_frame=True):
    scene.render.resolution_x = WIDTH; scene.render.resolution_y = h
    scene.render.filepath = f"{OUT}/{PRODUCT}-{name}-raw.png"
    bpy.ops.render.render(write_still=True)
    mw = cam.matrix_world; origin_c = mw.translation
    fwd = -(mw.to_3x3() @ Vector((0, 0, 1)))
    rng = random.Random(1)
    labels = []
    span = (bmax - bmin).max() * 4
    for p, g in zip(parts, geo):
        if p["hidden"] or not len(g["v"]):
            continue
        idx = np.arange(len(g["v"]))
        if len(idx) > SAMPLES:
            idx = np.array(rng.sample(range(len(idx)), SAMPLES))
        vis = []
        for i in idx:
            pt = Vector(g["v"][i].tolist())
            uv = world_to_camera_view(scene, cam, pt)
            if not (0.005 < uv.x < 0.995 and 0.005 < uv.y < 0.995) or uv.z <= 0:
                continue
            if cam_data.type == "ORTHO":
                o_ = pt - fwd * span; dd = fwd
            else:
                o_ = origin_c; dd = (pt - origin_c).normalized()
            loc_, nrm, fi, dist = bvh.ray_cast(o_, dd)
            if fi is None:
                continue
            hit_n = int(OWN[fi])
            if hit_n == p["n"] or (loc_ - pt).length * unit_scale < 0.3:
                vis.append((uv.x * WIDTH, (1 - uv.y) * h))
        if not vis:
            continue
        a = np.array(vis); m = a.mean(0)
        k = int(np.argmin(((a - m) ** 2).sum(1)))
        labels.append({"n": p["n"], "x": float(a[k][0]), "y": float(a[k][1])})
    json.dump({"image": f"{PRODUCT}-{name}.png", "raw": f"{PRODUCT}-{name}-raw.png", "labels": labels}, open(f"{OUT}/{PRODUCT}-labels-{name}.json", "w"))
    print(f"sheet {name}: {len(labels)} labelled parts")

diag = float(np.linalg.norm(ext))
cx, cy = [i for i in range(3) if i != up]
# top view: image x = +axis a, image up = +axis b (b chosen so that for Z-up it is X right, Y up)
ax_r = Vector([1.0 if i == (0 if up != 0 else 1) else 0.0 for i in range(3)])
ax_u = Vector([1.0 if i == (1 if up == 2 else 2 if up == 1 else 2) else 0.0 for i in range(3)])
ax_u = upv.cross(ax_r) * -1 if False else ax_u
iw = abs(sum(ext[i] * ax_r[i] for i in range(3))); ih = abs(sum(ext[i] * ax_u[i] for i in range(3)))
margin = 1.06
H = int(WIDTH * ih / iw) if iw else WIDTH
set_camera("ortho", centre + upv * diag * 2, centre, ortho_scale=iw * margin, hintv=ax_u)
H = max(200, int(WIDTH * ih / iw * 1.0 + 0.5)) if True else H
# ortho_scale spans the larger of width/height at the sensor; keep width as the driver
if ih > iw:
    cam_data.ortho_scale = ih * margin
sheet("top", H)

# quadrants: q1 TL, q2 TR, q3 BL, q4 BR (image space)
full_scale = cam_data.ortho_scale
for qi, (sx, sy) in enumerate([(-1, 1), (1, 1), (-1, -1), (1, -1)], 1):
    c = centre + ax_r * (sx * iw / 4) + ax_u * (sy * ih / 4)
    set_camera("ortho", c + upv * diag * 2, c, ortho_scale=iw / 2 * margin, hintv=ax_u)
    sheet(f"top-q{qi}", int(WIDTH * (ih / iw)))

# 3/4 perspective
cam_data.type = "PERSP"; cam_data.lens = 50; cam_data.sensor_width = 36
dirv = (-ax_u * 0.9 + ax_r * 0.5 + upv * 0.75).normalized()  # from front-right-above (front = -image-up)
dist = diag
for _ in range(60):
    set_camera("persp", centre + dirv * dist, centre, hintv=upv)
    scene.render.resolution_x = WIDTH; scene.render.resolution_y = int(WIDTH * 0.66)
    corners = [Vector((x, y, z)) for x in (bmin[0], bmax[0]) for y in (bmin[1], bmax[1]) for z in (bmin[2], bmax[2])]
    uvs = [world_to_camera_view(scene, cam, c) for c in corners]
    if all(0.04 < u.x < 0.96 and 0.04 < u.y < 0.96 for u in uvs):
        break
    dist *= 1.06
sheet("34", int(WIDTH * 0.66))
print("done ->", OUT)
