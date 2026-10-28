import { Color3, DynamicTexture, Mesh, MeshBuilder, ParticleSystem, TransformNode, Vector3 } from "@babylonjs/core";
import { SPECIALS } from "../data/spells.js";
import { LAUNCH_DISTANCE } from "./bolts.js";
import { createGlowMaterial } from "./materials.js";

// Fiendfyre's "beast" look (data/spells.js `look`), after the films: a huge head of fire with its
// jaws gaping, white-hot fangs and a glowing throat, pouring flames. No solid body: the flames it
// sheds stay where they're born (particles live in the arena, not on the head), so as it swings
// round its arc they leave a trail of fire behind it.
//
// The rules own its size (serpent.radius grows as it closes in); this view scales the head to match:
// built full-grown, scaled down by `size` (radius ÷ the full-grown radius) while it's young.

// The full-grown head, in metres. +z is forward (rotation.y = heading points it where it goes).
const SNOUT = 1.9; // from the jaw hinge to the tip of the snout
const WIDTH = 1.0;
const MOUTH_AHEAD = 1.2; // the rules' bite point is in the open mouth, this far ahead of the hinge
const BIG = 1.3; // the whole head is drawn this much bigger than the measurements above
const LOW = 0.85; // hinge height when it's newborn...
const HIGH = 1.45; // ...and full-grown: it rears up as it grows
const RAISED = -0.12; // radians the head tilts up, roaring (negative x-rotation tips the front up)
const ROAR_SPEED = 7; // how fast the jaws snap (radians per second of a sine wave)

// Materials and the flame picture, shared by every beast. Made once (view/specials.js).
export function createBeastLooks(scene) {
  return {
    fangs: createGlowMaterial("beastFangMat", "#fff6d8", scene), // white-hot, like the film's
    throat: createGlowMaterial("beastThroatMat", "#fff1b0", scene),
    eyes: createGlowMaterial("beastEyeMat", "#ffe066", scene),
    flame: createFlameTexture(scene),
  };
}

export function createBeast(scene, serpent, duel, { fire, glow, effects, beast }, origin) {
  const special = SPECIALS[duel.wizards[serpent.owner].data.special];
  const root = new TransformNode("fiendfyreBeast", scene); // the jaw hinge; everything hangs under it
  // The same lively fire as the caterpillar's body: its boiling surface keeps the big jaws from
  // looking like smooth shells.
  const { upper, lower } = buildHead(scene, root, fire, beast, glow);
  const flames = createBeastFlames(scene, special, beast.flame, effects);
  const launch = createLaunch(serpent, special, origin);

  function sync(state, time) {
    const { scale, forward } = poseHead(root, upper, lower, state, special, time, launch.lift(state));
    // Particles don't grow with a parent like meshes do: the flames get the size each frame.
    flames.sync(root.position, forward, scale);
  }
  sync(serpent, 0);

  return {
    sync,
    dispose() {
      flames.stop(); // the last flames burn out where they are
      root.dispose(); // and every mesh under it
    },
  };
}

// Like a bolt, a beast bursts out of the real wand tip (`origin`) and glides onto the rules' path
// over its first LAUNCH_DISTANCE metres. lift(state) is how far the drawn mouth is from the rules'
// bite point now: all the way at the wand, nothing once it has flown far enough.
export function createLaunch(serpent, special, origin) {
  const start = { x: serpent.x, z: serpent.z };
  const offset = origin.subtract(anchor(serpent, special));
  let fade = 1; // 1 at the wand, 0 once it has flown LAUNCH_DISTANCE; it only goes down
  return {
    lift(state) {
      const travelled = Math.hypot(state.x - start.x, state.z - start.z);
      fade = Math.min(fade, Math.max(0, 1 - travelled / LAUNCH_DISTANCE));
      return offset.scale(fade);
    },
  };
}

// Places a beast's head (also the sculpted serpent's, view/fiendfyre_sculpted.js): `root` at the jaw
// hinge, the rules' bite point in its open mouth, rearing up as it grows, turned where it's heading,
// scaled to its size; the jaws on their pivots (`upper`, `lower`) snap open and shut. Returns the
// scale it's drawn at and its forward direction (length 1).
export function poseHead(root, upper, lower, state, special, time, lift) {
  const scale = sizeOf(state, special).size * BIG;
  const forward = new Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
  const mouth = anchor(state, special).addInPlace(lift);
  root.position.copyFrom(mouth).subtractInPlace(forward.scale(MOUTH_AHEAD * scale));
  root.rotation.set(RAISED, state.heading, 0);
  root.scaling.setAll(scale); // one line grows the whole head: jaws, fangs, eyes, throat
  // The roar: the jaws gape wider and narrower, the lower one more than the upper.
  const open = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(time * ROAR_SPEED));
  upper.rotation.x = -0.45 * open; // negative x-rotation tips the front up...
  lower.rotation.x = open; // ...positive tips it down
  return { scale, forward };
}

// Where the bite point is drawn: the rules' x, z, at the head's height (which rises as it grows).
function anchor(state, special) {
  const { growth } = sizeOf(state, special);
  return new Vector3(state.x, LOW + (HIGH - LOW) * growth, state.z);
}

// size: how big the head is drawn (1 = full-grown); growth: 0 newborn → 1 full-grown. Both come from
// the rules' serpent.radius, so what you see is exactly what bites.
function sizeOf(state, special) {
  const growth = (state.radius - special.startRadius) / (special.endRadius - special.startRadius);
  return { size: state.radius / special.endRadius, growth: Math.min(1, Math.max(0, growth)) };
}

// ---- The head ----

// Two jaws, each on its own pivot (a TransformNode at the hinge), so opening the mouth is just a
// rotation.x on each. A jaw is half a ball (CreateSphere's `slice`), stretched long. DOUBLESIDE
// makes Babylon add the inside faces too, so you can look into the burning mouth.
function buildHead(scene, root, fire, { fangs, throat, eyes }, glow) {
  const half = (name, parent) => {
    const mesh = MeshBuilder.CreateSphere(name, { diameter: 1, slice: 0.5, segments: 24, sideOrientation: Mesh.DOUBLESIDE }, scene);
    mesh.parent = parent;
    mesh.material = fire;
    glow(mesh);
    return mesh;
  };
  // A fang: a cone (a cylinder whose top is 0 wide) at the jaw's rim, pointing at the other jaw.
  const fang = (parent, x, z, length, pointsDown) => {
    const cone = MeshBuilder.CreateCylinder("beastFang", { height: length, diameterTop: 0, diameterBottom: length * 0.32, tessellation: 8 }, scene);
    cone.parent = parent;
    cone.material = fangs;
    cone.rotation.x = pointsDown ? Math.PI : 0; // a cylinder's top points up (+y)
    cone.position.set(x, pointsDown ? -length / 2 : length / 2, z);
  };

  const upper = new TransformNode("beastUpperJaw", scene);
  upper.parent = root;
  const skull = half("beastSkull", upper);
  skull.scaling.set(WIDTH, 0.8, SNOUT); // a dome 0.4 m high
  skull.position.z = SNOUT / 2; // from the hinge to the snout
  // The back of the head, over the hinge, so it's a head and not a clam shell...
  const cranium = MeshBuilder.CreateSphere("beastCranium", { diameter: 1, segments: 20 }, scene);
  cranium.parent = upper;
  cranium.material = fire;
  glow(cranium);
  cranium.scaling.set(WIDTH * 1.1, 0.85, 1.1);
  cranium.position.set(0, 0.15, 0.2);
  // ...and heavy brows over the eyes, for a scowl.
  for (const side of [-1, 1]) {
    const brow = MeshBuilder.CreateSphere("beastBrow", { diameter: 1, segments: 12 }, scene);
    brow.parent = upper;
    brow.material = fire;
    glow(brow);
    brow.scaling.set(0.42, 0.16, 0.5);
    brow.rotation.y = -0.4 * side; // the inner ends point forward and down: angry
    brow.rotation.z = 0.25 * side;
    brow.position.set(0.3 * side, 0.43, 0.95);
  }
  for (const side of [-1, 1]) {
    fang(upper, 0.3 * side, 1.58, 0.42, true); // the two great fangs
    fang(upper, 0.42 * side, 1.2, 0.22, true);
    fang(upper, 0.45 * side, 0.85, 0.18, true);
    // Eyes: flattened, slanted, on top of the skull, sticking out of the fire.
    const eye = MeshBuilder.CreateSphere("beastEye", { diameter: 0.2, segments: 8 }, scene);
    eye.parent = upper;
    eye.material = eyes;
    eye.scaling.set(1.5, 0.55, 1);
    eye.rotation.y = 0.35 * side;
    eye.position.set(0.3 * side, 0.33, 1.1);
  }

  const lower = new TransformNode("beastLowerJaw", scene);
  lower.parent = root;
  const jaw = half("beastJaw", lower);
  jaw.rotation.z = Math.PI; // upside down: the bottom half of a ball
  jaw.scaling.set(WIDTH * 0.85, 0.5, SNOUT * 0.9);
  jaw.position.z = SNOUT * 0.45;
  for (const side of [-1, 1]) {
    fang(lower, 0.25 * side, 1.45, 0.3, false);
    fang(lower, 0.36 * side, 1.05, 0.18, false);
  }

  // Deep in the mouth, a white-hot glow (the brightest thing in the film's beast).
  const glowBall = MeshBuilder.CreateSphere("beastThroat", { diameter: 0.6, segments: 12 }, scene);
  glowBall.parent = root;
  glowBall.material = throat;
  glowBall.position.set(0, -0.05, 0.35);
  return { upper, lower };
}

// ---- The flames ----

// Four particle systems, all using the flame picture and its colours (data/spells.js `fire`):
// a mane of flames shooting up off the head, a stream of big flames shed behind it (its "body",
// left along its path), flames pouring out of the mouth, and embers. Additive blending: the
// flames' light adds up where they overlap.
export function createBeastFlames(scene, special, texture, effects) {
  const colors = special.fire.colors.map((hex) => Color3.FromHexString(hex));
  // Over its life a flame cools: pale yellow → orange → red → gone.
  const cooling = (particles, alpha) => {
    particles.addColorGradient(0, colors[4].toColor4(alpha));
    particles.addColorGradient(0.25, colors[3].toColor4(alpha * 0.9));
    particles.addColorGradient(0.6, colors[2].toColor4(alpha * 0.55));
    particles.addColorGradient(1, colors[1].toColor4(0));
  };
  const system = (name, capacity, setup) => {
    const particles = new ParticleSystem(name, capacity, scene);
    particles.particleTexture = texture;
    particles.emitter = new Vector3(0, -10, 0);
    particles.blendMode = ParticleSystem.BLENDMODE_ADD;
    particles.minInitialRotation = -0.3; // a little lean either way, so they don't look stamped
    particles.maxInitialRotation = 0.3;
    setup(particles);
    particles.start();
    return particles;
  };

  // With size gradients the gradient's values are the sizes in metres (for a full-grown beast);
  // the scale (set every frame below) shrinks them while it's young.
  // The mane keeps up with the head: its flames are launched forward at the beast's own speed (the
  // box emitter's directions, set every frame below), so they wrap the head instead of being left
  // behind like the body's.
  const mane = system("beastMane", 300, (p) => {
    p.createBoxEmitter(new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Vector3(-0.5, -0.1, -0.5), new Vector3(0.5, 0.4, 0.5));
    cooling(p, 0.85);
    p.addSizeGradient(0, 0.55);
    p.addSizeGradient(0.4, 0.75);
    p.addSizeGradient(1, 0.15);
    p.minLifeTime = 0.35;
    p.maxLifeTime = 0.75;
    p.minEmitPower = 1; // the speed is in the directions
    p.maxEmitPower = 1;
    p.emitRate = 260;
    p.gravity = new Vector3(0, 5, 0); // flames shoot upward
  });
  const body = system("beastBody", 340, (p) => {
    p.createSphereEmitter(0.4, 1);
    cooling(p, 0.6);
    p.addSizeGradient(0, 0.8);
    p.addSizeGradient(0.35, 1.1);
    p.addSizeGradient(1, 0.3);
    p.minLifeTime = 0.6;
    p.maxLifeTime = 1.1;
    p.minEmitPower = 0.2;
    p.maxEmitPower = 0.6;
    p.emitRate = 280;
    p.gravity = new Vector3(0, 2.2, 0);
  });
  const breath = system("beastBreath", 160, (p) => {
    // A box emitter shoots along its two directions (set to the head's forward every frame).
    p.createBoxEmitter(new Vector3(0, 0, 1), new Vector3(0, 0, 1), new Vector3(-0.15, -0.1, -0.1), new Vector3(0.15, 0.1, 0.1));
    cooling(p, 0.8);
    p.addSizeGradient(0, 0.3);
    p.addSizeGradient(0.5, 0.7);
    p.addSizeGradient(1, 0.2);
    p.minLifeTime = 0.25;
    p.maxLifeTime = 0.45;
    p.minEmitPower = 3;
    p.maxEmitPower = 5;
    p.emitRate = 160;
    p.gravity = new Vector3(0, 3, 0);
  });
  const embers = system("beastEmbers", 150, (p) => {
    p.createSphereEmitter(0.6, 1);
    cooling(p, 1);
    p.minSize = 0.04; // no size gradient here: minSize..maxSize, fixed for life
    p.maxSize = 0.1;
    p.minLifeTime = 0.8;
    p.maxLifeTime = 1.6;
    p.minEmitPower = 1;
    p.maxEmitPower = 3;
    p.emitRate = 80;
    p.gravity = new Vector3(0, 1.2, 0);
  });
  const all = [mane, body, breath, embers];

  return {
    // hinge: where the head's hinge is now; forward: which way it faces (length 1); size: how big
    // the head is drawn (1 = the measurements at the top of this file).
    sync(hinge, forward, size) {
      const up = new Vector3(0, 1, 0);
      const side = new Vector3(forward.z, 0, -forward.x);
      mane.emitter.copyFrom(hinge).addInPlace(forward.scale(0.9 * size)).addInPlace(up.scale(0.25 * size));
      body.emitter.copyFrom(hinge).addInPlace(forward.scale(0.2 * size));
      breath.emitter.copyFrom(hinge).addInPlace(forward.scale(1.6 * size)).addInPlace(up.scale(-0.05 * size));
      embers.emitter.copyFrom(hinge).addInPlace(forward.scale(0.8 * size));
      // A box emitter picks each particle's direction between direction1 and direction2. The mane's:
      // the beast's velocity, plus a little sideways spread and some upward. The mouth's: forward.
      const velocity = forward.scale(special.speed);
      mane.particleEmitterType.direction1 = velocity.add(side.scale(-0.5)).addInPlace(up.scale(0.3));
      mane.particleEmitterType.direction2 = velocity.add(side.scale(0.5)).addInPlace(up.scale(1.5));
      mane.particleEmitterType.minEmitBox = new Vector3(-0.6, -0.1, -0.6).scaleInPlace(size); // around the head
      mane.particleEmitterType.maxEmitBox = new Vector3(0.6, 0.5, 0.6).scaleInPlace(size);
      breath.particleEmitterType.direction1 = forward.add(side.scale(0.25)).addInPlace(up.scale(0.1));
      breath.particleEmitterType.direction2 = forward.subtract(side.scale(0.25)).addInPlace(up.scale(0.3));
      body.particleEmitterType.radius = 0.4 * size;
      embers.particleEmitterType.radius = 0.6 * size;
      for (const p of all) {
        // scale × size = a particle's drawn size; taller than wide, like flames. New particles get
        // the scale they're born with, so the flames grow as the beast does.
        p.minScaleX = p.maxScaleX = size;
        p.minScaleY = p.maxScaleY = size * 1.3;
      }
    },
    stop() {
      for (const p of all) {
        p.stop();
        effects.removeWhenDone(p); // removes itself once its last flame has burnt out
      }
    },
  };
}

// The flame picture: a soft teardrop, round at the bottom and pointed at the top, drawn as a column
// of soft dots that get smaller toward the top. White, so each particle's colour tints it.
function createFlameTexture(scene) {
  const size = 128;
  const texture = new DynamicTexture("flame", size, scene, false);
  const context = texture.getContext();
  context.clearRect(0, 0, size, size);
  for (let k = 0; k < 14; k++) {
    const t = k / 13; // 0 at the bottom, 1 at the tip
    const x = size / 2;
    const y = size * (0.74 - 0.64 * t);
    const r = size * (0.24 * Math.pow(1 - t, 0.8) + 0.025);
    const gradient = context.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.32)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  }
  texture.hasAlpha = true;
  texture.update();
  return texture;
}
