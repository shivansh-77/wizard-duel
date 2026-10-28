# Model pipeline, step 1b (only when Mixamo's auto-rigger fails on a model): a simpler version of the
# prepared model for Mixamo. Voldemort's low-detail PS2 mesh failed with "Unknown error while generating
# motion", so this script:
#   - removes the wand that is part of his mesh (the game gives him one in his hand, like Dumbledore's),
#   - splits every face into 4, so the skin has more points to bend around the joints,
#   - exports the .fbx without textures (Mixamo only needs the shape; 02_combine.py puts the original
#     materials back from the .blend, matched by name).
#
#   blender.exe --background --factory-startup --python blender/01b_simplify_for_mixamo.py -- <name>
#
# It reads models_build/<name>.blend (left as it is, so running this twice gives the same result) and
# writes <name>_simple.blend, <name>_simple_check.png, and <name>_for_mixamo.fbx (replacing the one
# from 01_prepare.py: upload this one).
import bpy, bmesh, sys, os
from mathutils import Vector

WAND_MIN_LENGTH = 0.2  # metres: a small loose piece at least this long is a wand
WAND_MAX_FACES = 50  # ...and it has only a few faces (eyes and teeth are small in every direction)

name = sys.argv[sys.argv.index("--") + 1]
project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_dir = os.path.join(project, "models_build")
bpy.ops.wm.open_mainfile(filepath=os.path.join(out_dir, f"{name}.blend"))
body = bpy.data.objects[name]


def islands(bm):
    """Groups of faces connected to each other: the separate pieces the mesh is made of."""
    seen, found = set(), []
    for face in bm.faces:
        if face in seen:
            continue
        stack, piece = [face], []
        seen.add(face)
        while stack:
            current = stack.pop()
            piece.append(current)
            for edge in current.edges:
                for other in edge.link_faces:
                    if other not in seen:
                        seen.add(other)
                        stack.append(other)
        found.append(piece)
    return found


# 1. Remove the wand: a loose piece with few faces that is long in one direction.
bm = bmesh.new()
bm.from_mesh(body.data)
removed = 0
for piece in islands(bm):
    points = [v.co for face in piece for v in face.verts]
    size = max(max(p[i] for p in points) - min(p[i] for p in points) for i in range(3))
    if len(piece) <= WAND_MAX_FACES and size >= WAND_MIN_LENGTH:
        verts = {v for face in piece for v in face.verts}
        bmesh.ops.delete(bm, geom=list(verts), context="VERTS")
        removed += 1
bm.to_mesh(body.data)
bm.free()

# 2. More geometry: cut every edge in two, so each face becomes 4 (flat: the shape doesn't change),
#    then point all the faces outward again.
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.subdivide(number_cuts=1)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")

# 3. Save a copy to look at, and the .fbx for Mixamo without textures. (The materials keep their names:
#    02_combine.py matches them with the originals in <name>.blend.)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, f"{name}_simple.blend"))
bpy.ops.export_scene.fbx(
    filepath=os.path.join(out_dir, f"{name}_for_mixamo.fbx"),
    use_selection=False,
    path_mode="STRIP",  # texture file names only, no pictures: Mixamo shows him plain
    embed_textures=False,
)

# 4. A check picture from the front, framed like 01_prepare.py's.
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
scene.render.filepath = os.path.join(out_dir, f"{name}_simple_check.png")
bpy.ops.render.render(write_still=True)
print(f"SIMPLIFIED {name}: removed {removed} wand piece(s); {len(body.data.vertices)} vertices, {len(body.data.polygons)} faces")
