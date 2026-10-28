# Model pipeline, step 1: turn a game model (.obj + textures) into a clean, game-sized mesh ready
# for rigging. Run it with Blender in the background (no window needed):
#
#   blender.exe --background --factory-startup --python blender/01_prepare.py -- <name> <path to .obj>
#
# It writes, in models_build/ (kept out of git and out of the web server, like models_source/):
#   <name>.blend             the prepared model, to open in Blender
#   <name>_for_mixamo.fbx    the same, with its textures packed inside, ready to upload to Mixamo
#   <name>_check.png         a picture from the front, to check the result
import bpy, sys, os
from mathutils import Vector

HEIGHT = 1.85  # metres, feet to the top of the head (CLAUDE.md: wizards are about 1.85 m tall)

name, obj_path = sys.argv[sys.argv.index("--") + 1:][:2]
project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_dir = os.path.join(project, "models_build")
os.makedirs(out_dir, exist_ok=True)

# 1. An empty scene, then the model. The OBJ importer turns the game's "Y is up" into Blender's
#    "Z is up"; both models then face Blender's front (-Y), which becomes Babylon's +z (forward).
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=obj_path)
parts = [o for o in bpy.context.scene.objects if o.type == "MESH"]

# 2. One mesh: join all the parts (Voldemort comes in 25 pieces), then weld vertices that sit on top
#    of each other at the seams between parts, so the skin bends as one piece when it's rigged.
bpy.ops.object.select_all(action="DESELECT")
for part in parts:
    part.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
if len(parts) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = name
body.data.name = name
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=0.01)  # in the game's units (centimetres): 0.1 mm
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")

# 3. Game size: scale so he's HEIGHT tall, then move him so his feet touch the floor (z = 0) and
#    he stands in the middle (x = 0, y = 0). Apply both, so the mesh itself holds the new size.
points = [body.matrix_world @ v.co for v in body.data.vertices]
lowest = min(p.z for p in points)
highest = max(p.z for p in points)
scale = HEIGHT / (highest - lowest)
body.scale = (scale, scale, scale)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
points = [v.co for v in body.data.vertices]
centre_x = (min(p.x for p in points) + max(p.x for p in points)) / 2
centre_y = (min(p.y for p in points) + max(p.y for p in points)) / 2
body.location = (-centre_x, -centre_y, -min(p.z for p in points))
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
bpy.ops.object.shade_smooth()

# 4. Save: a .blend to work on, and an .fbx with its textures packed in, for Mixamo.
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, f"{name}.blend"))
bpy.ops.export_scene.fbx(
    filepath=os.path.join(out_dir, f"{name}_for_mixamo.fbx"),
    use_selection=False,
    path_mode="COPY",
    embed_textures=True,
)

# 5. A check picture from the front, 2.2 m tall frame, so both models can be compared side by side.
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = 500
scene.render.resolution_y = 700
camera_data = bpy.data.cameras.new("check")
camera_data.type = "ORTHO"
camera_data.ortho_scale = 2.2
camera = bpy.data.objects.new("check", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera.location = (0, -6, 1.0)
camera.rotation_euler = (Vector((0, 6, 0))).to_track_quat("-Z", "Y").to_euler()
scene.render.filepath = os.path.join(out_dir, f"{name}_check.png")
bpy.ops.render.render(write_still=True)

size = [round(c, 3) for c in body.dimensions]
print(f"PREPARED {name}: {len(body.data.vertices)} vertices, {len(body.data.polygons)} faces, size {size} m")
