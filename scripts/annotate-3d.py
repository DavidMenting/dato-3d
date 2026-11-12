"""
annotate-3d.py — pass 2 of the CAD pipeline (pass 1 is inspect.py).

    blender -b --factory-startup -P scripts/annotate-3d.py -- cad/Dato+DRUM+1.0.fbx drum

Turns the raw Fusion FBX into build/<product>.glb + build/<product>-motion.json:
normalise, recognise parts, name them with the control IDs from controls.js,
set pivots, measure travel, strip small internals, merge statics, flat palette
materials. Prints an OK / MISSING / EXTRA checklist against controls.js.

EVERY assumption about the CAD lives in the constants below. When the hardware
disagrees, change a constant and re-run. Never hand-edit the GLB.

Coordinate frames used in this file
  CAD   Fusion export as Blender imports it: metres, Z up, Crush at +X.
  SVG   faceplate.svg axes in mm, origin at the device centre: x right, y down.
        Crush is at −x, Repeat/Tempo at −y. (The handoff doc says Crush is SVG
        top; the SVG itself says left. The SVG wins, so that the dir vectors
        in controls.js port unchanged.)
  GLB   metres, Y up: x = SVG x, z = SVG y, y = height above the feet.
"""

import bpy, bmesh, sys, os, re, json, math
from mathutils import Matrix, Vector

# ============================================================================
# Constants: DRUM
# ============================================================================

DRUM = dict(
    # CAD → SVG is a 180° turn about the vertical axis: svg = (−X, +Y).
    cad_to_svg=lambda x, y: (-x, y),

    # Component-path patterns (Fusion names, Dutch) → role. First match wins.
    roles=[
        (r'seq knop',                     'step'),
        (r'Drumpad',                      'pad'),
        (r'Effect knop',                  'effect'),
        (r'play knop',                    'play'),
        (r'sample driehoke',              'select'),
        (r'/20kq',                        'knob'),      # pot shaft; no separate cap in the CAD
        (r'SLXXV3-10D',                   'pitch'),     # slide-pot lever
        (r'SW_Slide',                     'swing'),     # body + lever in one mesh, split below
        (r'basis silicone[^/]*/basis silicone[^/]*/Body[^/]*$', 'silicone'),  # mat, pad tops, icons
        (r'Faceplate DRUM',               'faceplate'), # plate + 95 print bodies
        (r'Refelt PL-DRUM',               'felt'),
        (r'Onderkant DRUM',               'case'),
        (r'Feet ',                        'feet'),
        (r'Screw ISO 7380',               'case'),      # two black screws in the rim
        # Internals: static, seen through the slider slots, knob holes, connector
        # openings and gaps when the camera orbits. (The moving shafts and levers
        # matched above; these are the bodies they sit in.)
        (r'Potentiometer_Song-Huei',      'potbody'),   # rotary + slide pot cans
        (r'_PCB',                         'pcb'),       # both boards, bare
        (r'DIN-5|TYPE-C|SW-SMD|TE-2-1734248|TE_2-84952', 'internal'),  # MIDI, USB-C, power switch, board-to-board
        (r'Jack_3\.5mm',                  'jack'),
        (r'Sufr4004',                     'internal'),  # speaker
        (r'Spacer 2|Trapesium refelt',    'spacer'),
        (r'Flachkopfschraube|Senkschraube', 'metal'),
    ],
    # Everything else (SMD parts, LEDs, tact switches: small and out of sight) is stripped.

    # Fusion appearance → palette entry, per role. '*' is the role's default.
    materials={
        'step':      {'*': 'silicone'},
        'pad':       {'*': 'silicone'},
        'play':      {'*': 'silicone'},
        'silicone':  {'Rubber - Hard': 'dark', '*': 'silicone'},
        'select':    {'*': 'dark'},
        'knob':      {'*': 'knob'},
        'pitch':     {'Opaque(255,255,255)': 'white', '*': 'knob'},
        'swing':     {'*': 'knob'},
        'faceplate': {'Powder Coat (White)': 'white', '*': 'print'},
        'felt':      {'*': 'felt'},
        'case':      {'*': 'case'},
        'feet':      {'*': 'case'},
        'potbody':   {'*': 'metal'},
        'pcb':       {'*': 'pcb'},
        'internal':  {'Steel - Satin': 'metal', '*': 'dark'},   # also the swing switch body
        'jack':      {'*': 'dark'},
        'spacer':    {'*': 'case'},
        'metal':     {'*': 'metal'},
    },
    effect_colours={'btn-crush': 'green', 'btn-random': 'yellow', 'btn-repeat': 'red', 'btn-filter': 'blue'},

    # Where things sit, in SVG axes. Effect buttons: nearest to these unit directions.
    effect_dirs={'btn-crush': (-1, 0), 'btn-filter': (1, 0), 'btn-repeat': (0, -1), 'btn-random': (0, 1)},
    knob_ids=lambda sx, sy: 'knob-tempo' if sy < 0 else 'knob-volume',
    # Quadrant → number. The SVG numbers pads and sliders differently (pads were
    # hand-labelled, sliders by annotate-svg.py's track_from_angle). controls.js
    # compensates: CC 21 (track 1) → pitch-slider-2, which sits beside drumpad-1.
    pad_quadrants={'TR': 1, 'BR': 2, 'BL': 3, 'TL': 4},
    slider_quadrants={'TL': 1, 'TR': 2, 'BR': 3, 'BL': 4},
    # select-N-up is the triangle with the smaller polar angle within its quadrant.
    select_up_is_smaller_angle=True,
    # Step rings: outermost first, ascending polar angle, rotated by RING_OFFSET.
    ring_offset=2,
    steps_per_ring=8,

    # Motion
    knob_range_deg=(-140.0, 140.0),   # 280° pots
    # The angle the CAD pose represents is read off the shaft's marker: at 0°
    # (CC 64) the marker points "up" for someone reading the knob's label, which
    # for both DRUM knobs is toward the device centre.
    knob_up_toward_centre=True,
    knob_rest_deg_fallback=0.0,       # if no marker is found
    # controls.js dir vectors all point toward the device centre (comment there
    # says "outward"; the numbers were checked on the device, so they win).
    pitch_cc127_inward=True,
    pitch_rated_travel_mm=20.0,       # SL20V3: 20 mm slide pot; caps the slot measurement
    pitch_svg_travel_units=84.85,     # ± travel in controls.js, for the cross-check
    # The pot shaft has a radial slot in its top that runs on as a groove down
    # the side; on the real part it is filled white (like the slide-pot levers).
    # Slot floor: faces pointing up, this far below the shaft top. Groove: faces
    # pointing outward, recessed from the shaft's outer radius, near the slot's
    # azimuth, down to max_depth.
    knob_marker=dict(floor_depth_mm=(0.1, 1.0), recess_mm=0.05, azimuth_deg=15.0, max_depth_mm=4.0),
    swing_dir_svg=(0, 1),             # controls.js dir for CC 9
    swing_travel_mm=2.0,              # ± between the outer detents; the CAD's end detent sits 1.94 mm off centre (SVG says ±2.5)
    # The CAD has the lever at an end detent. The cutout in the faceplate gives
    # the centre and the room: search this far around the lever for its edges.
    swing_cutout_search_mm=(3.5, 9.0),   # across, along
    swing_lever_min_z_above_plate_mm=1.0,
    press_mm={'effect': 0.75, 'pad': 0.5, 'select': 0.5, 'play': 0.5, 'step': 0.3},  # guesses, halved 2026-11-12 (David: too deep)
    lit_roles=('step', 'pad', 'play'),

    svg_mm_per_unit=0.1,              # 660 units centre→Crush = 66 mm in the CAD
)

# Flat palette (sRGB hex). The viewer keys on the material *name*.
PALETTE = {
    'white':    '#f7f6f1',
    'print':    '#2a2a2c',
    'silicone': '#e3e3df',
    'dark':     '#2f2f33',
    'knob':     '#1e1e20',
    'case':     '#232325',
    'felt':     '#9fcfb9',
    'metal':    '#b4b7bb',
    'pcb':      '#2f6b52',
    'green':    '#35c46b',
    'yellow':   '#ffd02e',
    'red':      '#ff4a3d',
    'blue':     '#3b82f6',
}

PRODUCTS = {'drum': DRUM}

# ============================================================================

argv = sys.argv[sys.argv.index('--') + 1:]
FBX, PRODUCT = argv[0], argv[1]
C = PRODUCTS[PRODUCT]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build')
os.makedirs(OUT, exist_ok=True)
MM = 0.001


def log(*a):
    print('[annotate]', *a)


# ---- import -----------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.fbx_import(filepath=os.path.abspath(FBX))
bpy.context.view_layer.update()


def path_of(o):
    parts = []
    while o:
        parts.append(o.name)
        o = o.parent
    return '/'.join(reversed(parts))


def role_of(path):
    for pat, role in C['roles']:
        if re.search(pat, path):
            return role
    return None


meshes = [o for o in bpy.data.objects if o.type == 'MESH']
kept, removed = [], {}
for o in meshes:
    p = path_of(o)
    r = role_of(p)
    if r:
        kept.append((o, r))
    else:
        comp = re.sub(r'(:\d+)?(\.\d+)?$', '', p.split('/')[1] if '/' in p else p)
        removed[comp] = removed.get(comp, 0) + 1

# ---- normalise: bake world transforms, CAD → Blender-space-of-GLB ------------
zmin = min((o.matrix_world @ Vector(c)).z for o in meshes for c in o.bound_box)
# GLB (Y up) = exporter(Blender Z up): x_glb = x_b, y_glb = z_b, z_glb = −y_b.
# Want x_glb = svg_x = −X, z_glb = svg_y = +Y  →  x_b = −X, y_b = −Y: Rz(180°).
NORM = Matrix.Translation((0, 0, -zmin)) @ Matrix.Rotation(math.pi, 4, 'Z')

parts = []  # dicts: obj, role, c (centre, Blender space), lo, hi
for o, r in kept:
    o.data = o.data.copy()
    m = NORM @ o.matrix_world
    o.data.transform(m)
    if m.determinant() < 0:
        o.data.flip_normals()
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
    parts.append({'obj': o, 'role': r})

for o in list(bpy.data.objects):
    if o not in [p['obj'] for p in parts]:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.update()


def measure(p):
    vs = [v.co for v in p['obj'].data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    p['lo'], p['hi'], p['c'] = lo, hi, (lo + hi) / 2
    # SVG mm: x_svg = x_b, y_svg = −y_b
    p['sx'], p['sy'] = p['c'].x / MM, -p['c'].y / MM
    p['r'] = math.hypot(p['sx'], p['sy'])
    p['ang'] = math.degrees(math.atan2(p['sy'], p['sx']))


for p in parts:
    measure(p)


def by_role(r):
    return [p for p in parts if p['role'] == r]


def quadrant(p):
    return ('T' if p['sy'] < 0 else 'B') + ('R' if p['sx'] > 0 else 'L')


def select(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def join(target, others):
    if not others:
        return
    select([target] + others, target)
    bpy.ops.object.join()


# ---- swing switch: split the lever from the switch body ----------------------
plate = max(by_role('faceplate'), key=lambda p: len(p['obj'].data.vertices))
plate_top = plate['hi'].z
notes = []
for p in by_role('swing'):
    select([p['obj']])
    bpy.ops.mesh.separate(type='LOOSE')
    pieces = list(bpy.context.selected_objects)
    lever = []
    for o in pieces:
        top = max(v.co.z for v in o.data.vertices)
        (lever if top > plate_top + C['swing_lever_min_z_above_plate_mm'] * MM else []).append(o)
    rest = [o for o in pieces if o not in lever]
    log(f'swing switch: {len(pieces)} loose pieces, {len(lever)} reach above the faceplate')
    parts.remove(p)
    if lever and rest:
        join(lever[0], lever[1:])
        parts.append({'obj': lever[0], 'role': 'swing'})
        join(rest[0], rest[1:])   # switch body: stays put under the plate
        parts.append({'obj': rest[0], 'role': 'internal'})
    else:
        join(pieces[0], pieces[1:])
        parts.append({'obj': pieces[0], 'role': 'swing'})
        notes.append('swing switch is one connected mesh: the whole switch moves, not just the lever')
    measure(parts[-1])

# ---- materials ---------------------------------------------------------------
def srgb_to_linear(h):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return [f(int(h[i:i + 2], 16)) for i in (1, 3, 5)] + [1.0]


PAL = {}
for name, hx in PALETTE.items():
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = srgb_to_linear(hx)
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    PAL[name] = m


def paint(p, override=None):
    table = C['materials'].get(p['role'], {'*': 'white'})
    o = p['obj']
    if not o.material_slots:
        o.data.materials.append(None)
    for slot in o.material_slots:
        src = re.sub(r'\.\d+$', '', slot.material.name) if slot.material else ''
        slot.material = PAL[override or table.get(src, table['*'])]


# ---- recognise + name --------------------------------------------------------
named = {}    # id → part
motion = []


def glb(v):   # Blender-space vector → GLB coords
    return [round(v.x, 6), round(v.z, 6), round(-v.y, 6)]


def svg_dir_to_glb(dx, dy):
    n = math.hypot(dx, dy)
    return [round(dx / n, 6), 0.0, round(dy / n, 6)]


def set_origin(p, pivot):
    o = p['obj']
    o.data.transform(Matrix.Translation(-pivot))
    o.location = pivot
    p['pivot'] = pivot


def register(id_, p, type_, axis, lo, hi, unit, pivot=None, **extra):
    p['obj'].name = id_
    p['obj'].data.name = id_
    set_origin(p, pivot if pivot is not None else Vector((p['c'].x, p['c'].y, p['lo'].z)))
    named[id_] = p
    motion.append({'id': id_, 'type': type_, 'axis': axis, 'pivot': glb(p['pivot']),
                   'min': lo, 'max': hi, 'unit': unit, **extra})


DOWN = [0.0, -1.0, 0.0]
press = lambda role: round(C['press_mm'][role] * MM, 6)
lit = lambda role: role in C['lit_roles']

# silicone loose bodies: the big one is the mat (static); thin dark ones are pad
# tops / icons / the play disc and ride on the nearest pad or play button.
riders = {}
sil = by_role('silicone')
movers = by_role('pad') + by_role('play')
for p in sil:
    paint(p)
    size = p['hi'] - p['lo']
    if size.z > 0.5 * MM:
        p['role'] = 'static'
        continue
    host = min(movers, key=lambda m: math.hypot(m['sx'] - p['sx'], m['sy'] - p['sy']))
    if math.hypot(host['sx'] - p['sx'], host['sy'] - p['sy']) < 16:
        riders.setdefault(id(host), []).append(p)
    else:
        p['role'] = 'static'
for host in movers:
    paint(host)
    rs = riders.get(id(host), [])
    join(host['obj'], [r['obj'] for r in rs])
    for r in rs:
        parts.remove(r)

# effect buttons
for id_, (dx, dy) in C['effect_dirs'].items():
    p = max(by_role('effect'), key=lambda p: p['sx'] * dx + p['sy'] * dy)
    paint(p, C['effect_colours'][id_])
    register(id_, p, 'press', DOWN, 0.0, press('effect'), 'm')

# pads
for p in by_role('pad'):
    n = C['pad_quadrants'][quadrant(p)]
    register(f'drumpad-{n}', p, 'press', DOWN, 0.0, press('pad'), 'm', lit=True)

# play
for p in by_role('play'):
    register('play-outer', p, 'press', DOWN, 0.0, press('play'), 'm', lit=True)

# sample-select triangles
for q, n in C['pad_quadrants'].items():
    pair = sorted([p for p in by_role('select') if quadrant(p) == q], key=lambda p: p['ang'])
    if len(pair) != 2:
        notes.append(f'select triangles in quadrant {q}: found {len(pair)}, expected 2')
        continue
    if not C['select_up_is_smaller_angle']:
        pair.reverse()
    for p, d in zip(pair, ('up', 'down')):
        paint(p)
        register(f'select-{n}-{d}', p, 'press', DOWN, 0.0, press('select'), 'm')

# step buttons: rings by radius, outermost first
steps = sorted(by_role('step'), key=lambda p: -p['r'])
n_ring = C['steps_per_ring']
if len(steps) % n_ring:
    notes.append(f'{len(steps)} step buttons do not divide into rings of {n_ring}')
i = 0
for k in range(len(steps) // n_ring):
    ring = sorted(steps[k * n_ring:(k + 1) * n_ring], key=lambda p: p['ang'])
    spread = max(p['r'] for p in ring) - min(p['r'] for p in ring)
    if spread > 2:
        notes.append(f'step ring {k}: radius spread {spread:.1f} mm, ring split is suspect')
    ring = ring[C['ring_offset']:] + ring[:C['ring_offset']]
    for p in ring:
        paint(p)
        register(f'step-{i:02d}', p, 'press', DOWN, 0.0, press('step'), 'm', lit=True, ring=k)
        i += 1

def paint_knob_marker(p):
    k = C['knob_marker']
    me, cx, cy, top = p['obj'].data, p['c'].x, p['c'].y, p['hi'].z
    polar = lambda v: (math.hypot(v.x - cx, v.y - cy), math.atan2(v.y - cy, v.x - cx), top - v.z)
    r_out = max(polar(v.co)[0] for v in me.vertices if top - v.co.z < k['max_depth_mm'] * MM)
    lo, hi = (d * MM for d in k['floor_depth_mm'])
    floor = [f for f in me.polygons if f.normal.z > 0.9 and lo < top - f.center.z < hi]
    if not floor:
        notes.append(f"{p['obj'].name}: no marker slot found in the shaft top")
        return None
    az = math.atan2(sum(math.sin(polar(f.center)[1]) for f in floor), sum(math.cos(polar(f.center)[1]) for f in floor))
    near = lambda a: abs((a - az + math.pi) % (2 * math.pi) - math.pi) < math.radians(k['azimuth_deg'])
    groove = []
    for f in me.polygons:
        r, a, d = polar(f.center)
        radial = (f.normal.x * math.cos(a) + f.normal.y * math.sin(a))
        r_max = max(polar(me.vertices[i].co)[0] for i in f.vertices)
        if radial > 0.9 and near(a) and lo < d < k['max_depth_mm'] * MM and r_max < r_out - k['recess_mm'] * MM:
            groove.append(f)
    me.materials.append(PAL['white'])
    for f in floor + groove:
        f.material_index = len(me.materials) - 1
    area = sum(f.area for f in floor + groove) / MM ** 2
    # Clockwise angle (seen from above) from label-up to the marker, in SVG axes.
    vx, vy = math.cos(az), -math.sin(az)
    s = 1 if C['knob_up_toward_centre'] else -1
    ux, uy = -s * p['sx'], -s * p['sy']
    rest = math.degrees(math.atan2(ux * vy - uy * vx, ux * vx + uy * vy))
    log(f"knob marker: {len(floor)} floor + {len(groove)} groove faces, {area:.1f} mm², CAD pose = {rest:+.0f}°")
    return rest


# knobs: pivot on the shaft axis (bbox centre of a cylinder)
for p in by_role('knob'):
    paint(p)
    rest = paint_knob_marker(p)
    if rest is None:
        rest = C['knob_rest_deg_fallback']
    lo_deg, hi_deg = C['knob_range_deg']
    if not lo_deg - 5 <= rest <= hi_deg + 5:
        notes.append(f"knob at svg ({p['sx']:+.0f}, {p['sy']:+.0f}): CAD pose {rest:+.0f}° is outside the pot's range")
    # axis −Y: positive angles turn clockwise seen from above
    register(C['knob_ids'](p['sx'], p['sy']), p, 'rotate', DOWN, lo_deg, hi_deg, 'deg',
             rest=round(rest, 1))


def extent_along(verts, origin, u):
    d = [(v.x - origin.x) * u.x + (v.y - origin.y) * u.y for v in verts]
    return min(d), max(d)


# pitch sliders: measure the slot in the faceplate
plate_top_verts = [v.co for v in plate['obj'].data.vertices if v.co.z > plate_top - 0.05 * MM]
svg_travel_mm = C['pitch_svg_travel_units'] * C['svg_mm_per_unit']
for p in by_role('pitch'):
    paint(p)
    n = C['slider_quadrants'][quadrant(p)]
    u = Vector((p['c'].x, p['c'].y, 0)).normalized()          # radial, outward (Blender space)
    w = Vector((-u.y, u.x, 0))
    near = [v for v in plate_top_verts
            if abs((v.x - p['c'].x) * w.x + (v.y - p['c'].y) * w.y) < 2.5 * MM
            and abs((v.x - p['c'].x) * u.x + (v.y - p['c'].y) * u.y) < 16 * MM]
    cap = extent_along([v.co for v in p['obj'].data.vertices], p['c'], u)
    cap_len = (cap[1] - cap[0]) / MM
    rated = C['pitch_rated_travel_mm'] / 2
    if near:
        s0, s1 = extent_along(near, p['c'], u)
        slot_len = (s1 - s0) / MM
        off = (s0 + s1) / 2 / MM
        travel = min((slot_len - cap_len) / 2, rated)
        src = f'slot {slot_len:.1f} mm, lever {cap_len:.1f} mm, lever {off:+.1f} mm off slot centre'
    else:
        travel, src = rated, 'slot not found, using rated travel'
        notes.append(f'pitch-slider-{n}: slot not found in the faceplate')
    if abs(travel - svg_travel_mm) / svg_travel_mm > 0.10:
        notes.append(f'pitch-slider-{n}: travel ±{travel:.1f} mm vs SVG ±{svg_travel_mm:.1f} mm (>10% apart; CAD wins)')
    log(f'pitch-slider-{n}: ±{travel:.2f} mm ({src})')
    s = -1 if C['pitch_cc127_inward'] else 1
    axis = svg_dir_to_glb(s * u.x, s * -u.y)
    t = round(travel * MM, 6)
    register(f'pitch-slider-{n}', p, 'translate', axis, -t, t, 'm')

# swing switch lever
for p in by_role('swing'):
    paint(p)
    dx, dy = C['swing_dir_svg']
    u = Vector((dx, -dy, 0)).normalized()                      # SVG dir in Blender space
    w = Vector((-u.y, u.x, 0))
    across, along = (d * MM for d in C['swing_cutout_search_mm'])
    lever = [v.co for v in p['obj'].data.vertices if v.co.z > plate_top]
    lc = Vector((sum(v.x for v in lever) / len(lever), sum(v.y for v in lever) / len(lever), 0))
    l0, l1 = extent_along(lever, lc, u)
    edge = [v for v in plate_top_verts
            if abs((v.x - lc.x) * w.x + (v.y - lc.y) * w.y) < across
            and abs((v.x - lc.x) * u.x + (v.y - lc.y) * u.y) < along]
    t = C['swing_travel_mm']
    off = 0.0
    if edge:
        c0, c1 = extent_along(edge, lc, u)
        room = ((c1 - c0) - (l1 - l0)) / 2 / MM
        off = ((l0 + l1) / 2 - (c0 + c1) / 2) / MM             # lever centre − cutout centre, along dir
        t = min(t, room)
        log(f'swing: cutout {(c1 - c0) / MM:.1f} mm, lever {(l1 - l0) / MM:.1f} mm, room ±{room:.2f} mm, '
            f'CAD pose {off:+.2f} mm from centre → travel ±{t:.2f} mm')
    else:
        notes.append('swing: cutout not found in the faceplate, lever not centred')
    # min…max are offsets from the CAD pose; their midpoint is the cutout centre.
    register('slider-swing', p, 'translate', svg_dir_to_glb(dx, dy),
             round((-t - off) * MM, 6), round((t - off) * MM, 6), 'm')

# ---- statics: paint, then merge into one mesh (one primitive per material) ----
statics = [p for p in parts if p['obj'].name not in named or named.get(p['obj'].name) is not p]
for p in statics:
    if p['role'] not in ('static',):
        paint(p)
    select([p['obj']])
join(statics[0]['obj'], [p['obj'] for p in statics[1:]])
static = statics[0]['obj']
static.name = static.data.name = 'static'

# tidy: drop unused slots, smooth shading is kept from the FBX normals
for o in bpy.data.objects:
    select([o])
    bpy.ops.object.material_slot_remove_unused()

# ---- export --------------------------------------------------------------------
glb_path = os.path.join(OUT, f'{PRODUCT}.glb')
bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', use_selection=False,
                          export_yup=True, export_apply=False, export_materials='EXPORT',
                          export_texcoords=False, export_animations=False,
                          export_cameras=False, export_lights=False)

motion.sort(key=lambda m: m['id'])
with open(os.path.join(OUT, f'{PRODUCT}-motion.json'), 'w') as f:
    json.dump({'product': PRODUCT, 'space': 'GLB local: metres, Y up, x = SVG x, z = SVG y',
               'palette': PALETTE, 'controls': motion}, f, indent=1)

# ---- checklist against controls.js ----------------------------------------------
js = open(os.path.join(ROOT, 'src', PRODUCT, 'controls.js')).read()
expected = set(re.findall(r"\bid:\s*'([^']+)'", js)) | set(re.findall(r"padId:\s*'([^']+)'", js))
if PRODUCT == 'drum':
    expected |= {f'step-{i:02d}' for i in range(32)} | {'play-outer'}
    expected |= {f'select-{n}-{d}' for n in range(1, 5) for d in ('up', 'down')}
    no_part = {'knob-resonance': 'CC 75 = 127 − CC 74, no physical control'}
else:
    no_part = {}

print('\n=== removed (small parts, out of sight) ===')
for k, v in sorted(removed.items(), key=lambda kv: -kv[1]):
    print(f'  {v:4d} × {k}')
print('\n=== checklist ===')
ok = missing = 0
for id_ in sorted(expected):
    if id_ in named:
        m = next(m for m in motion if m['id'] == id_)
        p = named[id_]
        print(f"  OK       {id_:16s} {m['type']:9s} {m['min']:+.4g} … {m['max']:+.4g} {m['unit']:3s} "
              f"svg-mm ({p['sx']:+6.1f}, {p['sy']:+6.1f})")
        ok += 1
    elif id_ in no_part:
        print(f'  SKIP     {id_:16s} {no_part[id_]}')
    else:
        print(f'  MISSING  {id_}')
        missing += 1
for id_ in sorted(set(named) - expected):
    print(f'  EXTRA    {id_}')
print(f'\n{ok} OK, {missing} MISSING, {len(set(named) - expected)} EXTRA')
if notes:
    print('\n=== notes ===')
    for n in notes:
        print('  !', n)
tris = sum(len(o.data.loop_triangles) or sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects)
print(f'\nwrote {glb_path} ({os.path.getsize(glb_path) / 1e6:.1f} MB, {len(bpy.data.objects)} objects, {tris} tris)')
