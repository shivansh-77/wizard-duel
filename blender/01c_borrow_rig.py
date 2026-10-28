# Model pipeline, step 1c (instead of Mixamo's auto-rigger, when it can't rig a model): give a model the
# skeleton of a wizard Mixamo did rig. Voldemort's arms hang inside a wide cape, so Mixamo can't find
# them; Dumbledore's rig fits him (both 1.85 m tall, in long robes). And since it is the very same
# skeleton, every Mixamo animation downloaded for Dumbledore plays on Voldemort too.
#
#   blender.exe --background --factory-startup --python blender/01c_borrow_rig.py -- <name> <donor>
#
# Reads models_build/<name>_simple.blend (from 01b, or <name>.blend) and the donor's
# models_source/mixamo/<donor>/idle.fbx (his mesh and skeleton, downloaded "With Skin").
# Writes models_build/<name>_rigged.blend (02_combine.py uses it instead of an idle.fbx with skin) and
# two pictures: <name>_rigged_rest.png (the skeleton's own pose) and <name>_rigged_posed.png (as built).
#
# How: (1) bend the donor skeleton's arms down so its hands sit in the model's hands; (2) give every
# vertex of the model the bone weights of the nearest points of the donor's body, bent the same way;
# (3) "unbend" the model into the skeleton's rest pose (an A-pose), so that bending it back gives
# exactly the model as it was; (4) bind it to the skeleton.
import bpy, sys, os
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

NEAREST = 4  # each vertex blends the weights of this many nearest donor points
MAX_BONES = 4  # bones per vertex (what the glTF exporter keeps)

name, donor_name = sys.argv[sys.argv.index("--") + 1:][:2]
project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
build = os.path.join(project, "models_build")
simple = os.path.join(build, f"{name}_simple.blend")
bpy.ops.wm.open_mainfile(filepath=simple if os.path.exists(simple) else os.path.join(build, f"{name}.blend"))
scene = bpy.context.scene
model = bpy.data.objects[name]


def update():
    bpy.context.view_layer.update()


# 1. The donor: his mesh and skeleton, standing in the skeleton's rest pose (no animation).
before = set(scene.objects)
bpy.ops.import_scene.fbx(filepath=os.path.join(project, "models_source", "mixamo", donor_name, "idle.fbx"))
added = set(scene.objects) - before
armature = next(o for o in added if o.type == "ARMATURE")
donor = next(o for o in added if o.type == "MESH")
armature.animation_data.action = None
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
for bone in armature.pose.bones:
    bone.matrix_basis = Matrix.Identity(4)
update()

# 2. The model's hands. Voldemort's are separate pieces: the two biggest after his body. The one on the
#    same side (x) as the skeleton's right hand is his right hand. His wrist: the top of the piece.
def pieces(mesh):
    neighbours = {v.index: set() for v in mesh.vertices}
    for edge in mesh.edges:
        a, b = edge.vertices
        neighbours[a].add(b)
        neighbours[b].add(a)
    seen, found = set(), []
    for start in neighbours:
        if start in seen:
            continue
        stack, piece = [start], []
        seen.add(start)
        while stack:
            index = stack.pop()
            piece.append(index)
            for other in neighbours[index] - seen:
                seen.add(other)
                stack.append(other)
        found.append(piece)
    return sorted(found, key=len, reverse=True)


world = [model.matrix_world @ v.co for v in model.data.vertices]
hands = pieces(model.data)[1:3]
wrists = {}
for piece in hands:
    points = sorted((world[i] for i in piece), key=lambda p: p.z, reverse=True)
    top = points[: max(3, len(points) // 8)]
    wrist = sum(top, Vector()) / len(top)
    bone_x = (armature.matrix_world @ armature.pose.bones["mixamorig:RightHand"].head).x
    side = "Right" if (wrist.x < 0) == (bone_x < 0) else "Left"
    wrists[side] = wrist

# 3. Bend the skeleton's arms down: an IK constraint pulls each forearm's end (the wrist) onto the
#    model's wrist. Read the pose it makes, then remove the constraints and keep that pose.
targets = []
for side, wrist in wrists.items():
    target = bpy.data.objects.new(f"{side}WristTarget", None)
    scene.collection.objects.link(target)
    target.location = wrist
    targets.append(target)
    ik = armature.pose.bones[f"mixamorig:{side}ForeArm"].constraints.new("IK")
    ik.target = target
    ik.chain_count = 2  # the forearm and the upper arm
update()
chain = [f"mixamorig:{side}{part}" for side in wrists for part in ("Arm", "ForeArm")]
bent = {bone: armature.pose.bones[bone].matrix.copy() for bone in chain}
for side in wrists:
    pose_bone = armature.pose.bones[f"mixamorig:{side}ForeArm"]
    pose_bone.constraints.remove(pose_bone.constraints[0])
for bone in chain:  # parents first: each bone's pose is set relative to its parent's
    armature.pose.bones[bone].matrix = bent[bone]
    update()
for target in targets:
    bpy.data.objects.remove(target)

# 4. Weights from the nearest points of the donor's body, bent the same way (his armature deforms him).
depsgraph = bpy.context.evaluated_depsgraph_get()
donor_mesh = donor.evaluated_get(depsgraph).to_mesh()
tree = KDTree(len(donor_mesh.vertices))
for v in donor_mesh.vertices:
    tree.insert(donor.matrix_world @ v.co, v.index)
tree.balance()
group_names = {g.index: g.name for g in donor.vertex_groups}
donor_weights = [{group_names[g.group]: g.weight for g in v.groups if g.weight > 0} for v in donor.data.vertices]
donor.evaluated_get(depsgraph).to_mesh_clear()

weights = []
for point in world:
    blend = {}
    for _, index, distance in tree.find_n(point, NEAREST):
        closeness = 1 / max(distance, 1e-4)  # nearer points count more
        for bone, weight in donor_weights[index].items():
            blend[bone] = blend.get(bone, 0) + weight * closeness
    strongest = sorted(blend.items(), key=lambda item: item[1], reverse=True)[:MAX_BONES]
    total = sum(weight for _, weight in strongest)
    weights.append({bone: weight / total for bone, weight in strongest})

# 5. Unbend the model into the rest pose. The armature moves a vertex with the weighted sum of its bones'
#    matrices (from rest to pose); the inverse of that sum takes it back from the pose to rest.
to_world, to_armature = armature.matrix_world, armature.matrix_world.inverted()
moves = {
    bone.name: to_world @ bone.matrix @ bone.bone.matrix_local.inverted() @ to_armature
    for bone in armature.pose.bones
}
to_model = model.matrix_world.inverted()
for vertex, point, bones in zip(model.data.vertices, world, weights):
    move = Matrix(((0, 0, 0, 0),) * 4)
    for bone, weight in bones.items():
        move += moves[bone] * weight
    vertex.co = to_model @ (move.inverted() @ point)

# 6. Bind: vertex groups named after the bones, an Armature modifier, and the skeleton as parent.
for index, bones in enumerate(weights):
    for bone, weight in bones.items():
        group = model.vertex_groups.get(bone) or model.vertex_groups.new(name=bone)
        group.add([index], weight, "REPLACE")
modifier = model.modifiers.new("Armature", "ARMATURE")
modifier.object = armature
model.parent = armature
model.matrix_parent_inverse = armature.matrix_world.inverted()
bpy.data.objects.remove(donor)
armature.name = name


# 7. Pictures: the rest pose (what animations start from), then bent back (it should look as before).
def picture(file):
    scene.render.filepath = os.path.join(build, file)
    bpy.ops.render.render(write_still=True)


scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = 500
scene.render.resolution_y = 700
camera = bpy.data.objects.new("check", bpy.data.cameras.new("check"))
camera.data.type = "ORTHO"
camera.data.ortho_scale = 2.2
scene.collection.objects.link(camera)
scene.camera = camera
camera.location = (0, -6, 1.0)
camera.rotation_euler = (Vector((0, 6, 0))).to_track_quat("-Z", "Y").to_euler()
picture(f"{name}_rigged_posed.png")
bent_pose = {bone.name: bone.matrix_basis.copy() for bone in armature.pose.bones}
for bone in armature.pose.bones:
    bone.matrix_basis = Matrix.Identity(4)
update()
picture(f"{name}_rigged_rest.png")

# 8. Save it in the rest pose, without the picture camera.
bpy.data.objects.remove(camera)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(build, f"{name}_rigged.blend"))
used = sorted({bone for bones in weights for bone in bones})
print(f"RIGGED {name} with {donor_name}'s skeleton: {len(model.data.vertices)} vertices, {len(used)} bones used, wrists {[(s, [round(c, 2) for c in w]) for s, w in wrists.items()]}")
