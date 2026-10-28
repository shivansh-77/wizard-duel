import { Color3, FresnelParameters, MeshBuilder, StandardMaterial, TransformNode } from "@babylonjs/core";
import { PROTEGO } from "../data/spells.js";
import { createMaterial } from "./materials.js";

// A stand-in wizard made of simple shapes (step 13 swaps in a real model). Sizes are in metres.
// The parts hang under TransformNodes, so moving or turning a node carries everything below it:
//
//   root          stands on the platform: where the wizard is and which way he faces (syncWizard)
//   ├ body        floats GLIDE above the root and bobs; its origin is at the robe's hem
//   │ ├ robe, head, eyes, hat, beard
//   │ └ shoulder  pivot of the wand arm: it rises to cast
//   │   ├ sleeve, hand
//   │   └ wand    pivot at the hand
//   │     ├ stick
//   │     └ wandTip   an empty point at the tip, where spells start (wandTipPosition)
//   └ protego     the shield bubble
const GLIDE = 0.15; // the hem floats this far above the platform
const BOB_HEIGHT = 0.03; // the hover bob goes 3 cm up and down...
const BOB_SPEED = 2; // ...at 2 radians per second: one full bob about every 3 seconds
const ARM_SPEED = 18; // how quickly the arm moves to its pose (per second)
const FALL_TIME = 0.45; // seconds to fall over on a KO
const FLASH_TIME = 0.12; // seconds a hit flashes the wizard white

// Builds one wizard from his data (see data/wizards.js) and returns his view: the nodes that move,
// and a little memory for animations (arm pose, KO fall, flashes).
export function createWizard(scene, shadows, data) {
  const { name, colors } = data;

  const root = new TransformNode(name, scene); // syncWizard places and turns it every frame

  const body = new TransformNode(`${name}Body`, scene);
  body.parent = root;
  body.position.y = GLIDE;

  const robeMaterial = createMaterial(`${name}RobeMat`, colors.robe, scene);
  const skinMaterial = createMaterial(`${name}SkinMat`, colors.skin, scene);

  // Robe: a cylinder with a narrow top, i.e. a cone with its tip cut off.
  const robe = MeshBuilder.CreateCylinder(
    `${name}Robe`,
    { height: 1.35, diameterTop: 0.36, diameterBottom: 0.8, tessellation: 24 },
    scene,
  );
  robe.position.y = 1.35 / 2; // built around its centre: lift it so the hem sits at the body's origin
  robe.material = robeMaterial;
  robe.parent = body;

  const head = MeshBuilder.CreateSphere(`${name}Head`, { diameter: 0.32, segments: 16 }, scene);
  head.position.y = 1.53;
  head.material = skinMaterial;
  head.parent = body;

  addEyes(scene, data, body);
  if (colors.hat) addHat(scene, name, colors.hat, body);
  if (colors.beard) addBeard(scene, name, colors.beard, body);
  const { shoulder, wand, wandTip } = addWandArm(scene, data, body, robeMaterial, skinMaterial);

  // Every body mesh casts and receives shadows. They're added one by one: a TransformNode can't
  // cast a shadow itself (see the pillars in view/arena.js).
  const meshes = root.getChildMeshes();
  for (const mesh of meshes) {
    mesh.receiveShadows = true;
    shadows.addShadowCaster(mesh);
    mesh.overlayColor = Color3.White(); // the colour of the hit flash (see syncWizard)
  }

  const protego = addProtego(scene, name, root); // after the loop: the bubble casts no shadow

  const view = {
    root, body, shoulder, wand, wandTip, protego, meshes,
    model: null, // his real model, once it has loaded (useModel)
    armLift: 0, armHold: 0, fall: 0, flash: 0, shieldFlash: 0,
    fallLift: 0.25, // how far the body rises as he falls: the stand-in tips over around its hem
  };

  // Hover bob. onBeforeRenderObservable runs our function before every frame is drawn.
  // Real time (performance.now) is fine here because this is only looks: gameplay never uses it.
  // Knocked out, he stops bobbing and lies on the platform instead.
  const phase = data.start.x; // a different starting point for each wizard, so they don't bob in step
  scene.onBeforeRenderObservable.add(() => {
    const seconds = performance.now() / 1000;
    const bob = Math.sin(seconds * BOB_SPEED + phase) * BOB_HEIGHT;
    body.position.y = GLIDE + bob * (1 - view.fall) + view.fallLift * view.fall;
  });

  return view;
}

// Copies a wizard's gameplay state (game/duel.js) onto his view, every frame. The view only reads
// the state: the rules decide where he is, which way he faces, whether he's casting or shielding.
// `seconds` is the frame's duration, for smooth animations.
export function syncWizard(view, state, seconds) {
  view.root.position.x = state.x;
  view.root.position.z = state.z;
  view.root.rotation.y = state.facing; // radians; 0 = facing +z, Babylon's "forward"
  view.root.setEnabled(state.transit === 0); // apparating: gone from the scene while "in between"

  if (view.model) {
    view.model.sync(state); // a real model: its clips show casting, beaming, shielding, the KO...
  } else {
    // The stand-in's wand arm: up while casting, beaming or using his special (and a moment after a
    // bolt leaves), half up behind Protego, down otherwise. armLift eases toward that goal (0 = down,
    // 1 = up) so the arm moves smoothly.
    view.armHold = Math.max(0, view.armHold - seconds);
    const busy = state.castTimer > 0 || state.beamTimer > 0 || state.beaming || state.specialTimer > 0 || state.whip;
    const pointing = busy || view.armHold > 0;
    const goal = pointing ? 1 : state.shieldUp ? 0.6 : 0;
    view.armLift += (goal - view.armLift) * Math.min(1, ARM_SPEED * seconds);
    view.shoulder.rotation.x = lerp(0.6, 0, view.armLift); // from hanging forward to straight ahead
    view.wand.rotation.x = lerp(-0.75, -0.05, view.armLift); // the wand straightens out too
  }

  // Protego: visible while up, brighter for a moment when it stops a bolt.
  view.shieldFlash = Math.max(0, view.shieldFlash - seconds);
  view.protego.isVisible = state.shieldUp;
  view.protego.material.alpha = 0.35 + view.shieldFlash * 3;

  // KO: he tips over backwards, faster and faster (fall² feels like gravity). On a restart he's
  // standing again at once.
  // (A real model plays its own KO clip: the body only sinks to the floor.)
  view.fall = state.down ? Math.min(1, view.fall + seconds / FALL_TIME) : 0;
  if (!view.model) view.body.rotation.x = -(view.fall * view.fall) * (Math.PI / 2); // a negative x-rotation tips "up" backwards

  // Hit flash: an overlay paints every mesh white, fading out over FLASH_TIME.
  view.flash = Math.max(0, view.flash - seconds);
  for (const mesh of view.meshes) {
    mesh.renderOverlay = view.flash > 0;
    mesh.overlayAlpha = view.flash / FLASH_TIME;
  }
}

// Swaps the stand-in for his real model (view/wizard_model.js) once it has loaded: the stand-in's
// shapes are switched off, and the hit flash now paints the model.
export function useModel(view, model) {
  for (const mesh of view.meshes) mesh.setEnabled(false);
  view.meshes = model.meshes;
  view.model = model;
  if (model.wandTip) view.wandTip = model.wandTip; // spells now start from the wand in his animated hand
  view.fallLift = -GLIDE; // knocked out, the model lies on the platform: no more gliding
}

// Where his wand's tip is in the world right now, for bolts, beams and the whip to start from (the
// rules use a fixed point in front of him; this is only looks). Babylon refreshes world matrices while
// it draws a frame, and syncWizard has just moved him since: so refresh the chain of nodes from his
// root down to the tip first, top to bottom, or we'd get where the tip was a moment ago.
export function wandTipPosition(view) {
  const chain = [];
  for (let node = view.wandTip; node; node = node.parent) chain.unshift(node);
  for (const node of chain) node.computeWorldMatrix(true);
  return view.wandTip.getAbsolutePosition().clone();
}

// Called by view/reactions.js when the rules report an event about this wizard.
export function showCast(view) {
  view.armHold = 0.2; // keep the arm up a moment after the bolt leaves (a real model plays its clip)
}
export function showHit(view) {
  view.flash = FLASH_TIME;
  view.model?.trigger("hit");
}
export function showShieldStop(view) {
  view.shieldFlash = 0.15;
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

// Two small eyes on the front of the head (+z is forward): they show which way he faces.
function addEyes(scene, data, body) {
  const material = createMaterial(`${data.name}EyeMat`, data.colors.eyes, scene);
  if (data.glowingEyes) {
    // emissiveColor: light the material gives off itself, so it stays bright even in shadow.
    material.emissiveColor = Color3.FromHexString(data.colors.eyes);
  }
  for (const side of [-1, 1]) {
    const eye = MeshBuilder.CreateSphere(`${data.name}Eye`, { diameter: 0.05, segments: 8 }, scene);
    eye.position.set(side * 0.06, 1.55, 0.14);
    eye.material = material;
    eye.parent = body;
  }
}

// A pointed hat: a flat brim plus a cone (a cylinder whose top has diameter 0).
function addHat(scene, name, color, body) {
  const material = createMaterial(`${name}HatMat`, color, scene);
  const brim = MeshBuilder.CreateCylinder(`${name}HatBrim`, { height: 0.03, diameter: 0.5, tessellation: 24 }, scene);
  brim.position.y = 1.64;
  const cone = MeshBuilder.CreateCylinder(
    `${name}HatCone`,
    { height: 0.5, diameterTop: 0, diameterBottom: 0.3, tessellation: 24 },
    scene,
  );
  cone.position.y = 1.64 + 0.25;
  for (const part of [brim, cone]) {
    part.material = material;
    part.parent = body;
  }
}

// A beard: an upside-down cone hanging from the chin.
function addBeard(scene, name, color, body) {
  const beard = MeshBuilder.CreateCylinder(
    `${name}Beard`,
    { height: 0.5, diameterTop: 0.22, diameterBottom: 0, tessellation: 16 },
    scene,
  );
  beard.position.set(0, 1.17, 0.2);
  beard.rotation.x = -0.25; // about 14°: swings the tip forward so it lies on the robe, not inside it
  beard.material = createMaterial(`${name}BeardMat`, color, scene);
  beard.parent = body;
}

// The wand arm, built pointing forward (+z) under the `shoulder` pivot, then tilted down.
// Rotating the shoulder swings the whole arm: syncWizard raises it to cast.
function addWandArm(scene, data, body, robeMaterial, skinMaterial) {
  const { name } = data;
  const shoulder = new TransformNode(`${name}Shoulder`, scene);
  shoulder.parent = body;
  shoulder.position.set(0.2, 1.25, 0.03); // the right shoulder (+x is the wizard's right)
  shoulder.rotation.x = 0.6; // a positive x-rotation tips "forward" downward: the arm hangs forward

  // Sleeve: a cylinder stands upright when built, so rotation.x = 90° lays it along +z.
  // Narrow at the shoulder, wide at the cuff, like a wizard's sleeve.
  const sleeve = MeshBuilder.CreateCylinder(
    `${name}Sleeve`,
    { height: 0.55, diameterTop: 0.17, diameterBottom: 0.1, tessellation: 12 },
    scene,
  );
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = 0.55 / 2;
  sleeve.material = robeMaterial;

  const hand = MeshBuilder.CreateSphere(`${name}Hand`, { diameter: 0.09, segments: 8 }, scene);
  hand.position.z = 0.58;
  hand.material = skinMaterial;

  for (const part of [sleeve, hand]) part.parent = shoulder;

  // The wand pivots at the hand and tilts back up, so it aims ahead instead of at the floor.
  const wand = new TransformNode(`${name}Wand`, scene);
  wand.parent = shoulder;
  wand.position.z = 0.58;
  wand.rotation.x = -0.75;

  const stick = MeshBuilder.CreateCylinder(
    `${name}WandStick`,
    { height: 0.36, diameterTop: 0.02, diameterBottom: 0.035, tessellation: 8 },
    scene,
  );
  stick.rotation.x = Math.PI / 2;
  stick.position.z = 0.36 / 2;
  stick.material = createMaterial(`${name}WandMat`, data.colors.wand, scene);
  stick.parent = wand;

  const wandTip = new TransformNode(`${name}WandTip`, scene);
  wandTip.parent = wand;
  wandTip.position.z = 0.36;

  return { shoulder, wand, wandTip };
}

// Protego: a see-through glowing bubble around him, hidden until the shield is up.
function addProtego(scene, name, root) {
  const bubble = MeshBuilder.CreateSphere(`${name}Protego`, { diameter: PROTEGO.radius * 2, segments: 24 }, scene);
  bubble.position.y = 1.0;
  bubble.parent = root;
  bubble.isVisible = false;

  const material = new StandardMaterial(`${name}ProtegoMat`, scene);
  material.emissiveColor = Color3.FromHexString(PROTEGO.color).scale(0.6); // dimmed: the GlowLayer brightens it again
  material.disableLighting = true; // it's made of light: the scene's lights don't change it
  // Fresnel: the bubble is more opaque where you look across its surface (the rim) and nearly clear
  // where you look straight through it (the middle), like a soap bubble.
  material.opacityFresnelParameters = new FresnelParameters();
  material.opacityFresnelParameters.leftColor = Color3.White(); // at the rim: fully opaque
  material.opacityFresnelParameters.rightColor = new Color3(0.05, 0.05, 0.05); // facing you: almost clear
  material.opacityFresnelParameters.power = 2;
  bubble.material = material;
  return bubble;
}
