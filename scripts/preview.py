"""
preview.py — quick CPU render of build/<product>.glb, for checking the annotate
output where no browser is at hand (the Claude Code sandbox has no GPU).

    blender -b --factory-startup -P scripts/preview.py -- drum
Writes build/<product>-preview.png, seen from the viewer's default camera.
"""
import bpy, sys, os, math
from mathutils import Vector

product = sys.argv[sys.argv.index('--') + 1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(root, 'build', f'{product}.glb'))

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24
scene.render.resolution_x, scene.render.resolution_y = 1600, 1100
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('w'); world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.9, 0.9, 0.89, 1)
scene.world = world

sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 2.5; sun.data.angle = math.radians(10)
sun.rotation_euler = (math.radians(35), math.radians(-15), math.radians(150))
scene.collection.objects.link(sun)

# viewer camera (0.1, 0.42, −0.4) in GLB space = (0.1, 0.4, 0.42) in Blender space
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.lens = 60; cam.data.clip_start = 0.01
cam.location = Vector((0.1, 0.4, 0.42))
cam.rotation_euler = (Vector((0, 0, 0.03)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(cam); scene.camera = cam

scene.render.filepath = os.path.join(root, 'build', f'{product}-preview.png')
bpy.ops.render.render(write_still=True)
