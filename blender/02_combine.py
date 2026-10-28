# Model pipeline, step 2: combine a wizard's Mixamo downloads into one game model (.glb).
#
#   blender.exe --background --factory-startup --python blender/02_combine.py -- <name> [<clips>]
#
# Reads models_source/mixamo/<clips>/ (<clips> is <name> unless given):
#   idle.fbx      downloaded "With Skin": his mesh + skeleton + the idle animation
#   *.fbx         every other animation, downloaded "Without Skin": just the same skeleton, moving
# and models_build/<name>.blend (from step 1), for his original materials: Mixamo returns them black.
# A wizard rigged by 01c_borrow_rig.py (Mixamo couldn't rig him) has models_build/<name>_rigged.blend:
# his mesh + skeleton come from there instead, and idle.fbx is just one more clip.
#
# Writes public/models/<name>.glb: the mesh, the skeleton and one animation clip per file, named after
# the file (idle, cast, beam...). Babylon turns each clip into an AnimationGroup with that name.
# Also writes models_build/<name>_clip_<clip>.png: one frame from the middle of each clip, to check.
import bpy, sys, os

args = sys.argv[sys.argv.index("--") + 1:]
name = args[0]
project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
source = os.path.join(project, "models_source", "mixamo", args[1] if len(args) > 1 else name)
build = os.path.join(project, "models_build")
rigged = os.path.join(build, f"{name}_rigged.blend")
output = os.path.join(project, "public", "models")
os.makedirs(output, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30  # Mixamo's frame rate: keeps every clip at its real speed when frames become seconds


def import_fbx(file):
    """Imports one FBX and returns (the objects it added, the animation it brought)."""
    before_objects = set(scene.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=os.path.join(source, file))
    return set(scene.objects) - before_objects, (set(bpy.data.actions) - before_actions).pop()


def load_rigged():
    """Adds the mesh + skeleton saved by 01c_borrow_rig.py to the scene: returns (armature, mesh)."""
    with bpy.data.libraries.load(rigged) as (library, loaded):
        loaded.objects = list(library.objects)
    for obj in loaded.objects:
        scene.collection.objects.link(obj)
    return (next(o for o in loaded.objects if o.type == kind) for kind in ("ARMATURE", "MESH"))


def use_action(armature, action):
    """Makes `action` the one the armature plays (Blender 4.4+ actions have "slots": pick its only one)."""
    armature.animation_data.action = action
    if hasattr(armature.animation_data, "action_slot") and action.slots:
        armature.animation_data.action_slot = action.slots[0]


# 1. The character: mesh + skeleton (+ idle), from the file downloaded "With Skin", or from 01c's rig.
if os.path.exists(rigged):
    armature, mesh = load_rigged()
    clips = {}
else:
    objects, idle = import_fbx("idle.fbx")
    armature = next(o for o in objects if o.type == "ARMATURE")
    mesh = next(o for o in objects if o.type == "MESH")
    clips = {"idle": idle}
armature.name = name
if armature.animation_data is None:
    armature.animation_data_create()

# 2. Every other clip: import it, keep its animation, throw away its extra copy of the skeleton.
#    The bone names are the same in every file (mixamorig:Hips, ...), so the animation fits our skeleton.
for file in sorted(os.listdir(source)):
    clip = os.path.splitext(file)[0]
    if not file.lower().endswith(".fbx") or clip in clips:
        continue
    extra_objects, action = import_fbx(file)
    for extra in extra_objects:
        bpy.data.objects.remove(extra, do_unlink=True)
    clips[clip] = action
for clip, action in clips.items():
    action.name = clip
    action.use_fake_user = True  # keep it even while nothing plays it

# 3. His real look: swap Mixamo's black materials for the originals from step 1, matched by name
#    (mat1 ... mat6 for Dumbledore; Blender may have added ".001" to Mixamo's copies).
with bpy.data.libraries.load(os.path.join(build, f"{name}.blend")) as (library, loaded):
    loaded.materials = list(library.materials)
originals = {m.name: m for m in loaded.materials if m}
for slot in mesh.material_slots:
    base = slot.material.name.split(".")[0] if slot.material else None
    if base in originals:
        slot.material = originals[base]
for material in {slot.material for slot in mesh.material_slots if slot.material}:
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled:  # matte cloth and skin, not plastic
        principled.inputs["Roughness"].default_value = 0.85
        principled.inputs["Metallic"].default_value = 0.0
bpy.ops.file.pack_all()  # put the texture images inside the .glb

# 4. A check picture per clip: the frame halfway through, from the front-right.
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = 360
scene.render.resolution_y = 480
camera = bpy.data.objects.new("check", bpy.data.cameras.new("check"))
camera.data.type = "ORTHO"
camera.data.ortho_scale = 2.6
scene.collection.objects.link(camera)
scene.camera = camera
camera.location = (2.2, -5.0, 1.1)
camera.rotation_euler = (1.5708, 0, 0.4)
for clip, action in clips.items():
    use_action(armature, action)
    first, last = action.frame_range
    scene.frame_set(int((first + last) / 2))
    scene.render.filepath = os.path.join(build, f"{name}_clip_{clip}.png")
    bpy.ops.render.render(write_still=True)

# 5. One NLA track per clip, named after it: the glTF exporter turns each track into one animation.
armature.animation_data.action = None
for clip, action in clips.items():
    track = armature.animation_data.nla_tracks.new()
    track.name = clip
    strip = track.strips.new(clip, int(action.frame_range[0]), action)
    if hasattr(strip, "action_slot") and action.slots:
        strip.action_slot = action.slots[0]
    track.mute = True  # tracks don't mix in Blender; each is exported on its own

bpy.ops.export_scene.gltf(
    filepath=os.path.join(output, f"{name}.glb"),
    export_format="GLB",
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=True,
    export_skins=True,
    export_def_bones=True,  # only the bones that move the mesh
    export_optimize_animation_size=True,
)
lengths = {clip: round((action.frame_range[1] - action.frame_range[0]) / 30, 2) for clip, action in clips.items()}
print(f"COMBINED {name}: {len(armature.data.bones)} bones, clips (seconds) {lengths}")
