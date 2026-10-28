import { Color3, Mesh, MeshBuilder, MirrorTexture, Plane, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { ARENA } from "../data/arena.js";
import { drawFloorTiles, drawPlatformTop } from "./arena_art.js";
import { createMaterial } from "./materials.js";

// Builds the arena's meshes from the numbers in data/arena.js: the floor of the hall, the
// round platform with its stone top and gold rim, and a ring of pillars around it with fire on top.
// `shadows` is the ShadowGenerator: meshes added to it cast shadows. `effects` makes the flames.
// Returns the pillars (TransformNodes), for the camera to fade the ones in its way.
export function createArena(scene, shadows, effects) {
  createFloor(scene);
  createPlatform(scene, shadows);
  return { pillars: createPillars(scene, shadows, effects) };
}

// The floor of the hall, below the platform: big enough that its edges vanish in the fog.
// Its tile picture repeats every 8 m (4 tiles of 2 m): uScale/vScale = how many times across.
function createFloor(scene) {
  const size = 150;
  const floor = MeshBuilder.CreateGround("floor", { width: size, height: size }, scene);
  floor.position.y = -ARENA.height;
  const material = createMaterial("floorMat", "#ffffff", scene, 0.25); // white: the picture gives the colour
  material.diffuseTexture = drawFloorTiles(scene);
  material.diffuseTexture.uScale = size / 8;
  material.diffuseTexture.vScale = size / 8;
  floor.material = material;
  floor.receiveShadows = true;
}

function createPlatform(scene, shadows) {
  // A short, wide cylinder. Meshes are built around their centre, so we lower it by half its
  // height: its top surface lands exactly at y = 0, where the wizards will glide.
  const platform = MeshBuilder.CreateCylinder(
    "platform",
    { diameter: ARENA.radius * 2, height: ARENA.height, tessellation: 64 }, // 64 sides: looks round
    scene,
  );
  platform.position.y = -ARENA.height / 2;
  platform.material = createMaterial("platformMat", ARENA.colors.platform, scene);
  platform.receiveShadows = true;
  shadows.addShadowCaster(platform); // it also casts a shadow on the floor below

  createPlatformTop(scene);

  // A gold ring lying around the edge, so the edge of the fighting area is easy to see.
  const rim = MeshBuilder.CreateTorus(
    "rim",
    { diameter: ARENA.radius * 2, thickness: 0.15, tessellation: 64 },
    scene,
  );
  rim.material = createMaterial("rimMat", ARENA.colors.rim, scene, 0.6);
  rim.receiveShadows = true;
}

// The top of the platform: a flat disc a hair above the cylinder, wearing the stone picture.
// - diffuseTexture: the stone's colours (view/arena_art.js).
// - emissiveTexture: the runes and the magic circle, which shine by themselves (and pulse slowly).
// - reflectionTexture: a MirrorTexture. Babylon draws the scene a second time, upside down below
//   the mirror plane, into a texture; mixed in at a low level and blurred, the stone looks polished
//   and every spell is reflected in the floor.
function createPlatformTop(scene) {
  // CreateDisc builds a disc standing up, facing -z: tip it back 90° to lie flat, facing up.
  const top = MeshBuilder.CreateDisc("platformTop", { radius: ARENA.radius, tessellation: 96 }, scene);
  top.rotation.x = Math.PI / 2;
  top.position.y = 0.002; // just above the cylinder's own top, so the two don't flicker
  top.receiveShadows = true;

  const { stone, glow } = drawPlatformTop(scene);
  const material = new StandardMaterial("platformTopMat", scene);
  material.diffuseTexture = stone;
  material.emissiveTexture = glow;
  material.specularColor = new Color3(0.25, 0.25, 0.25); // polished: a soft shine where the light hits
  material.specularPower = 48;

  const mirror = new MirrorTexture("platformMirror", 512, scene, true);
  mirror.mirrorPlane = new Plane(0, -1, 0, 0); // the plane y = 0, seen from above
  mirror.level = ARENA.reflection;
  mirror.adaptiveBlurKernel = 24; // blurry, like polished stone rather than glass
  mirror.refreshRate = 2; // redrawn every other frame: half the cost (56 → 60 fps), and nobody can tell
  material.reflectionTexture = mirror;
  top.material = material;

  // What gets reflected: everything except the platform itself and the floor below it. The list is
  // made again every frame, because bolts and beams come and go. (Babylon's renderListPredicate
  // does the same job, but measured far slower here: 23 fps against 61.)
  const reflected = (mesh) => !mesh.name.startsWith("platform") && mesh.name !== "floor";
  scene.onBeforeRenderObservable.add(() => {
    mirror.renderList = scene.meshes.filter(reflected);
    // The runes breathe: the emissive texture's level goes slowly up and down.
    glow.level = 0.75 + 0.25 * Math.sin(performance.now() / 700);
  });
}

// The pillars stand in a ring around the platform, each with a brazier of fire on top.
function createPillars(scene, shadows, effects) {
  const { count, ringRadius, fromAngle, toAngle } = ARENA.pillars;
  // One material per kind, shared by every pillar: fewer materials means less work for the GPU.
  const materials = {
    stone: createMaterial("pillarMat", ARENA.colors.pillar, scene),
    bowl: createMaterial("brazierMat", ARENA.colors.brazier, scene, 0.5),
    coals: glowMaterial("coalsMat", ARENA.colors.flame, scene),
  };

  const pillars = [];
  for (let i = 0; i < count; i++) {
    // Spread the pillars evenly from fromAngle to toAngle, then turn each angle into x and z.
    const degrees = fromAngle + ((toAngle - fromAngle) * i) / (count - 1);
    const angle = (degrees * Math.PI) / 180;
    const pillar = createPillar(`pillar${i}`, materials, scene);
    pillar.position.set(Math.cos(angle) * ringRadius, -ARENA.height, Math.sin(angle) * ringRadius);

    // addShadowCaster needs meshes (things with a shape). The pillar itself is a TransformNode with
    // no shape, so we add its parts one by one: getChildMeshes() lists the meshes under it. Passing
    // the node itself stops the render loop ("getBoundingInfo is not a function"). Same for wizards.
    for (const part of pillar.getChildMeshes()) {
      part.receiveShadows = true;
      shadows.addShadowCaster(part);
    }

    // The fire: a particle fountain just above the bowl (a position in the world, not under the node).
    effects.flames(pillar.position.add(new Vector3(0, brazierTop(), 0)), ARENA.colors.flame);
    pillars.push(pillar);
  }
  return pillars;
}

// One pillar: a square base, a round shaft, a square top and a brazier (a bowl with glowing coals).
// The meshes are children of a TransformNode (an invisible "handle" with a position, rotation and
// scale): move the node and the whole pillar moves. Positions are relative to the node, on the floor.
function createPillar(name, materials, scene) {
  const { height, diameter } = ARENA.pillars;
  const block = diameter * 1.5; // the base and top are wider than the shaft
  const pillar = new TransformNode(name, scene);

  const base = MeshBuilder.CreateBox(`${name}Base`, { width: block, depth: block, height: 0.4 }, scene);
  base.position.y = 0.2;
  const shaft = MeshBuilder.CreateCylinder(`${name}Shaft`, { diameter, height, tessellation: 24 }, scene);
  shaft.position.y = 0.4 + height / 2;
  const top = MeshBuilder.CreateBox(`${name}Top`, { width: block, depth: block, height: 0.4 }, scene);
  top.position.y = 0.4 + height + 0.2;
  for (const part of [base, shaft, top]) part.material = materials.stone;

  // The brazier: a bowl wider at the top, and a disc of coals inside that glows by itself. The bowl
  // is open: only its bottom is capped (CAP_START), and both sides of its wall are drawn (DOUBLESIDE)
  // so its inside shows too.
  const bowl = MeshBuilder.CreateCylinder(
    `${name}Bowl`,
    {
      height: 0.35,
      diameterTop: block * 0.9,
      diameterBottom: block * 0.45,
      tessellation: 20,
      cap: Mesh.CAP_START,
      sideOrientation: Mesh.DOUBLESIDE,
    },
    scene,
  );
  bowl.position.y = brazierTop() - 0.175;
  bowl.material = materials.bowl;
  const coals = MeshBuilder.CreateCylinder(`${name}Coals`, { height: 0.02, diameter: block * 0.8, tessellation: 20 }, scene);
  coals.position.y = brazierTop() - 0.03;
  coals.material = materials.coals;

  for (const part of [base, shaft, top, bowl, coals]) part.parent = pillar;
  return pillar;
}

// How high a brazier's rim is above the pillar's foot: base, shaft, top block, then the bowl.
function brazierTop() {
  return 0.4 + ARENA.pillars.height + 0.4 + 0.35;
}

// A material made of light: only its emissive colour shows, and the GlowLayer makes it shine.
function glowMaterial(name, hex, scene) {
  const material = new StandardMaterial(name, scene);
  material.emissiveColor = Color3.FromHexString(hex);
  material.disableLighting = true;
  return material;
}
