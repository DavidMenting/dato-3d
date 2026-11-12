# CLAUDE.md

Browser 3D model of the Dato DRUM and DUO (three.js). MIDI from a real device moves the model's knobs, sliders, buttons and lights live. The goal is promotion (website, social video, show demos), not diagnostics: a believable result beats a complete one.

**Source of truth:** the handoff doc [Dato DRUM & DUO 3D visualizer: handoff](https://claude.ai/artifact/4NaumWGMzrG4YRqMd1BxgP). Read it with the Claude Docs tools, never with a web fetch. It holds the full motion tables, firmware facts, phase gates and open questions. This file only summarises it. If the two disagree, the doc wins: update this file.

## Running

```bash
npm run dev      # http://localhost:5173  (?demo=0: no fake performance, ?midi=0: no MIDI prompt)
npm run build
scripts/build-model.sh drum "cad/Dato+DRUM+1.0.fbx"   # pipeline steps 3+4 → public/models/
```

With no device plugged in, the viewer plays a fake performance (`src/drum/demo.js`) through the same `midi-*` events a real DRUM sends. A real device takes over on connect. The Demo button (bottom right) or the D key switches the demo off; the choice is kept in localStorage, and `?demo=` overrides it.

Claude's sandboxed shell can neither listen on a port nor reach localhost. David runs `npm run dev`; Claude checks the page through the Chrome DevTools MCP tools (`http://localhost:5173/?midi=0`), which is a good job for a Sonnet subagent. The sandbox also has no GPU (Blender Workbench/EEVEE fail; Cycles on CPU works). Without a browser, check the model with `blender -b --factory-startup -P scripts/preview.py -- drum` (→ `build/drum-preview.png`).

npm's default cache (`~/.npm`) is not writable in the Claude Code sandbox. Use `npm_config_cache=$TMPDIR/npm-cache npm install …`.

## Principles (from the doc)

- **MIDI in only.** The viewer sends nothing to the device, apart from the connect handshake kept from `device.js` (see Gotchas).
- **Map direct values directly** (CCs, notes, clock). Fake inferred state plausibly, or leave it out. Verify device details only when a shot visibly looks wrong.
- **Look:** clean and stylised. `MeshToonMaterial` with a 3-step gradient, flat palette colours, no outlines (David removed the inverted hull on 2026-11-12), no post-processing, one key light plus one hemisphere light, OrbitControls, plain background. Lit parts switch their emissive colour. A second, opt-in "Photo preset" in the Look panel (added 2026-11-12) switches to PBR materials with per-part roughness/metalness (`PBR` in `look.js`), studio reflections, tone mapping, a soft shadow and ambient occlusion; toon stays the default. Add things only when they're needed, in this order: faceplate print decal, soft contact shadow, felt/plywood textures, LED bloom.
- **Target fast machines.** For weak hardware or the website, render to video (record MIDI → replay → capture) instead of tuning down the scene.
- **All CAD assumptions live in `annotate-3d.py`** (part names, pivots, travel), as named constants at the top. When the hardware disagrees, change a constant and re-run. Don't hand-edit the GLB.

## Pipeline

| # | Step | Tool | Output |
|---|------|------|--------|
| 1 | Toon exports each assembly (Fusion 360) | — | `drum.fbx`, `duo.fbx` (+ `.step` backups) |
| 2 | Inspect: every body's name, bbox (mm), centroid, verts, colour | `blender -b -P scripts/inspect.py` | `<product>-parts.json`, numbered top + 3/4 contact sheet |
| 3 | Annotate: normalise (metres, Y-up, Crush / synth half to −Z), recognise parts, name them with the SVG IDs, set pivots, measure travel, strip small SMD parts, merge statics, flat materials, faceplate print | `blender -b -P scripts/annotate-3d.py` | `<product>.glb`, `<product>-motion.json`, OK/MISSING/EXTRA checklist |
| 4 | Optimise | `gltf-transform` | compressed GLB in `public/models/` |
| 5 | Viewer | three.js + Vite | the app |
| 6 | Check against the real device, fix constants in step 3 | browser + device | updated `annotate-3d.py` |

The viewer joins two files. `controls.js` maps MIDI to a control ID, and `motion.json` maps an ID to a movement: `{ id, type, axis, pivot, min, max, unit }` in GLB local space. GLB object names are the control IDs from `controls.js` (`knob-tempo`, `pitch-slider-1`, `step-00`, `key-0`, …). That naming is the contract.

Key motion conventions: knobs map CC 0→127 to −140°…+140° (280° pots; the old 2D faceplate used ±135°). Sliders: CC 127 = the far end along `dir`. Buttons press along the faceplate normal (depths are guesses, 0.3–0.75 mm; halved on 2026-11-12 because they looked too deep). Smooth DUO pot motion over about 30 ms (the firmware's hysteresis sends steps of 2). The full per-control tables are in the doc.

## Layout

```
src/
  main.js              scene, camera, wiring: model + live + demo + MIDI
  viewer/model.js      loads GLB + motion.json; model.set(id, 0…1) moves, model.light(id, colour, level) lights. Knows no MIDI
  viewer/look.js       LOOK_DEFAULTS (the shipped look), materials (toon / lambert / standard), lights
  viewer/stage.js      optional photo look: studio environment, tone mapping, soft shadow + floor, GTAO. Off by default
  viewer/tweaks.js     lil-gui "Look" panel (top right) edits the look live; kept in localStorage; H hides all UI
  drum/live.js         midi-* events → model (port of visualizer.js) + inferred play state / playhead + Filter/Crush LED effects
  drum/demo.js         fake performance, dispatches the same events as a device
  shared/midi.js       Web MIDI, typed midi-* CustomEvents on document, device profiles, autodetect  [copied as is]
  drum/controls.js     MIDI → control ID (the contract)                                          [copied as is]
  drum/device.js       DRUM SysEx: firmware request, sequencer-state polling (200 ms)            [bootloader + settings dropped]
  duo/controls.js      MIDI → control ID (the contract)                                          [copied as is]
  duo/device.js        DUO SysEx: firmware/serial request, Stop + reset-transpose on connect     [bootloader dropped]
  duo/derived.js       Speed/Length knob positions from clock and gate timing                    [lifted from duo/js/test.js]
  css/base.css         Dato tokens; css/app.css declares the Sailec font and page styles
assets/<product>/faceplate.svg   print artwork for the faceplate texture + 2D positions to cross-check part recognition
reference/             read-only material to port or mirror; not imported by the app
  shared/faceplate.js  ccToRotation / ccToTranslation / applyCC → port to motion.json transforms
  drum|duo/visualizer.js  pad/key hits, clock playhead, LEDs, play state → port as emissive changes
  drum|duo/annotate-svg.py  ordering rules (rings, quadrants, clockwise steps, keys) the 3D script mirrors
  duo/test.js          origin of derived.js; duo/firmware/MidiFunctions.h: what the DUO sends
  shared/test-page.js  autodetect by reloading with ?device=
  production-tests-CLAUDE.md  see "DUO specifics" and "Known gaps"
scripts/
  inspect.py + label_sheet.py   pass 1 → cad/out/<product>-parts.json/.tsv + numbered contact sheets
  annotate-3d.py                pass 2 → build/<product>.glb + -motion.json + checklist. All CAD assumptions, as constants at the top
  build-model.sh                annotate + gltf-transform (meshopt, named nodes kept) → public/models/
  preview.py                    CPU render of build/<product>.glb
cad/                   raw FBX/STEP exports + cad/out inspect output (git-ignored)
build/                 unoptimised GLB, motion.json, preview (git-ignored)
public/models/         optimised GLBs + motion.json served to the viewer
```

All files were copied from `dato-production-tests` at commit **e728a8d** ("DUO: step-1 is the right button of the top pair"). Don't import across repos. If the source changes, re-copy and note the new commit here.

## Ordering rules (mirror the SVG scripts)

- **DRUM:** quadrant tracks TL=1, TR=2, BR=3, BL=4. Step rings run outermost first, sorted by angle, with `RING_OFFSET = 2`. Step LEDs are wired step-major (4 LEDs per step, one per track). Which ring is track 1, where step 1 sits and the direction are unverified (`TRACK_STEP_MAP`).
- **DUO:** keys run left to right. Step 1 is the right button of the top pair, and the steps run clockwise. The synth half faces the second player (upside down).

## What the DRUM CAD contains (inspect, 2026-11-12)

- 1196 bodies, 196 × 196 × 55.5 mm, metres, Z up. Body names are generic; the Fusion component path is readable (`seq knop`, `Drumpad`, `Effect knop`, `play knop`, `sample driehoke knopjje`, `Faceplate DRUM`, `basis silicone`, `Refelt`, `Onderkant`). Roles are matched on that path.
- Internals are kept as static parts so the device isn't hollow when the camera orbits: pot and slide-pot bodies, swing switch body, connectors (DIN-5, jack, USB-C, power switch, board-to-board), both bare PCBs, speaker, spacer and inner screws (palette `metal`, `pcb`, `dark`). Only the small SMD parts, LEDs and tact switches (about 490 bodies) are stripped.
- The faceplate print is modelled as 95 thin bodies, so no texture decal is needed. Pad tops and icons are thin bodies too; they are joined to their pad.
- No knob caps and no slider caps: the pot shafts (`20kq`) and slide-pot levers (`SLXXV3-10D`) are the visible parts. The swing switch is one connected mesh, so the whole switch moves under the plate.
- Fusion appearances carry no colours for the effect buttons or triangles; the palette in `annotate-3d.py` sets them (green/yellow/red/blue, dark triangles).
- **GLB frame:** x = SVG x, z = SVG y, Y up. Crush is at −x and Repeat/Tempo at −z, because that is where `faceplate.svg` has them (the doc says "Crush = SVG top"; the SVG wins so `dir` vectors in controls.js port unchanged). The lettering reads upright from the −z side, where the default camera sits.
- **Numbering quirk:** the SVG numbers pads TR=1, BR=2, BL=3, TL=4 but pitch sliders TL=1, TR=2, BR=3, BL=4. controls.js compensates (CC 21 → `pitch-slider-2`, beside `drumpad-1`).
- **Pitch sliders:** slot 27 mm, lever 7 mm, travel capped at the pot's ±10 mm (SVG says ±8.5). The `dir` vectors in controls.js point toward the centre (CC 127 = inner end), although the comment there and the doc say "outer". The numbers win for now: `pitch_cc127_inward`.
- **Knobs:** the shaft's marker slot and groove are painted white. The CAD has both pots at −132° (near the minimum stop); `rest` in motion.json records that, so CC 64 points the marker toward the device centre ("up" for someone reading the label).
- **Swing switch:** the CAD has the lever at an end detent, 1.94 mm off the centre of its 11 mm cutout. motion.json's min…max are offsets from that pose, centred on the cutout, ±2 mm.
- The viewer never relies on GLB node origins (meshopt quantisation rewrites node transforms); it uses `pivot` from motion.json.

## Firmware facts that need new viewer logic

- **DRUM** sends no Start/Stop, and its clock runs even while stopped. Infer "playing" and the playhead by matching Note Ons against the polled pattern on the clock grid (6 pulses per step). The old `visualizer.js` relied on `midi-transport`, so this part is new. Filter (CC 74) dims and desaturates every LED down to 20%. Crush (CC 12) adds per-channel noise. Note colours should come from the firmware's `global_note_definitions` (config.h).
- **DUO:** step state is not on MIDI. Rebuild the pattern from heard notes, counting 12 clocks per step from Continue. Transpose is inferred from the note shift (±1 per press, range ±12). Boost = notes every 6 clocks instead of 12. Accent = velocity 127. Random sends nothing reliable. Step colours come from the firmware's `COLORS` table (Leds.h:23-48).

## Build phases

**Current focus: DRUM only.** The DUO waits until phases 2–5 are through. DRUM CAD: `cad/Dato+DRUM+1.0.fbx`.

1. **Setup** ✅ Blender + gltf-transform, Vite + three.js, files copied, this file.
2. **DRUM inspect** ✅ every visible part has a role (see "What the DRUM CAD contains").
3. **DRUM model** ✅ checklist: 56 OK, 0 MISSING, 0 EXTRA.
4. **DRUM live** ← works in the browser with the demo performance (look, motion of every control, LEDs checked 2026-11-12). With a real DRUM connected the controls respond well (David, 2026-11-12). Gate: a real performance looks right.
5. **Record and replay** MIDI to JSON, capture video. This is the main promo output, so it comes before the DUO.
6. **DUO:** steps 2–4, direct mappings first.
7. **Inferred state** where a shot needs it.
8. **Polish**, one item at a time.

## Tools on this Mac

- Blender **5.3** at `/opt/homebrew/bin/blender` (the doc says 4.x; 5.x is fine). Headless runs work inside the sandbox: `blender -b --factory-startup -P script.py -- args`.
- gltf-transform CLI at `~/.local/bin/gltf-transform`.
- Node 26, Python 3.12. STEP fallback (cadquery) only if the FBX meshing is too coarse; don't install it before then.

## Gotchas

- **DUO connect handshake sends Stop + reset-transpose** (`DUO.onConnected`). That was right for the production test, but it stops a running performance when the viewer connects. Decide before the DUO phase whether to drop it.
- The shell is zsh: in scripts, write `${VAR}:path`, not `$VAR:path` (zsh reads `:s`, `:h` etc. as modifiers).
- The Autodesk 360 web share is a viewer only. The model can't be pulled from it, so use Toon's FBX/STEP export.
