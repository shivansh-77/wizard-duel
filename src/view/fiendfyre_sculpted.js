import { Color3, MeshBuilder, ParticleSystem, TransformNode, Vector3 } from "@babylonjs/core";
import { SPECIALS } from "../data/spells.js";
import { createBeastFlames, createLaunch, poseHead } from "./fiendfyre_beast.js";
import { createBeastHeadGeometry } from "./geometry/beast_head_geometry.js";
import { createSerpentBodyGeometry, SERPENT_BODY } from "./geometry/serpent_body_geometry.js";

// Fiendfyre's "sculpted" look: a whole creature whose shapes are modelled with Node Geometry
// (view/geometry/): a big lumpy head with horns, brows and rows of teeth on hinged jaws, and a spiked
// body ending in a tail. The pieces are built once (createSculptedLooks); each cast clones the head
// pieces and lays instances of one body segment along the path its neck has taken. It moves and
// roars like the beast (poseHead) and burns with the same fire and flames.

const SEGMENTS = 12; // body segments behind the head
const NECK = 0.35; // the body starts this far behind the jaw hinge, full-grown
const TRAIL_STEP = 0.1; // the view remembers where the neck was every this many metres
// Each segment is smaller than the one before (1 at the neck → the tail's join size), and sits
// closer to it: the gap between two segments is SERPENT_BODY.spacing × its size, so they always
// overlap (a segment is 0.65 long). `along` is each piece's distance from the neck, full-grown.
const SIZES = Array.from({ length: SEGMENTS }, (_, k) => 1 - (1 - SERPENT_BODY.tailScale) * (k / (SEGMENTS - 1)));
const ALONG = [0];
for (let k = 1; k <= SEGMENTS; k++) ALONG.push(ALONG[k - 1] + SERPENT_BODY.spacing * SIZES[k - 1]); // the last = the tail

// Builds the Node Geometry pieces once and keeps them as hidden templates. `fire` is the fire
// material, `glow` adds a mesh to the GlowLayer, `beast` holds the shared fang/eye/throat materials.
export function createSculptedLooks(scene, fire, glow, beast) {
  const head = createBeastHeadGeometry(scene);
  const body = createSerpentBodyGeometry(scene);
  for (const mesh of [head.meshes.upperJaw, head.meshes.lowerJaw, body.meshes.segment, body.meshes.tailTip]) {
    mesh.material = fire;
    mesh.isVisible = false; // templates are never drawn themselves
  }
  head.meshes.upperTeeth.material = beast.fangs;
  head.meshes.lowerTeeth.material = beast.fangs;
  // Instances are drawn through their source mesh, so the GlowLayer needs to know the source.
  glow(body.meshes.segment);
  glow(body.meshes.tailTip);
  return { head, body };
}

export function createSculpted(scene, serpent, duel, { glow, effects, beast, sculpted }, origin) {
  const special = SPECIALS[duel.wizards[serpent.owner].data.special];
  const parts = sculpted.head.meshes;

  // The head: the same hinge-and-pivots layout as the beast's, with the sculpted pieces on it.
  const root = new TransformNode("fiendfyreSculpted", scene);
  const upper = new TransformNode("sculptedUpperJaw", scene);
  const lower = new TransformNode("sculptedLowerJaw", scene);
  upper.parent = root;
  lower.parent = root;
  // clone(): a new mesh sharing the template's geometry (no copy of the vertices).
  const copy = (template, parent, glows) => {
    const mesh = template.clone(`${template.name}Copy`, parent);
    mesh.isVisible = true;
    if (glows) glow(mesh);
    return mesh;
  };
  copy(parts.upperJaw, upper, true);
  copy(parts.upperTeeth, upper, false);
  copy(parts.lowerJaw, lower, true);
  copy(parts.lowerTeeth, lower, false);
  for (const at of sculpted.head.eyes) {
    const eye = MeshBuilder.CreateSphere("sculptedEye", { diameter: 0.16, segments: 8 }, scene);
    eye.parent = upper;
    eye.material = beast.eyes;
    eye.scaling.set(1.5, 0.6, 1);
    eye.position.copyFrom(at);
  }
  const throat = MeshBuilder.CreateSphere("sculptedThroat", { diameter: 0.6, segments: 12 }, scene);
  throat.parent = root;
  throat.material = beast.throat;
  throat.position.set(0, -0.05, 0.35);

  // The body: instances of one segment, and the tail tip. createInstance() copies share the source's
  // geometry and material, and the GPU draws all of them in one go.
  const segments = Array.from({ length: SEGMENTS }, (_, k) => sculpted.body.meshes.segment.createInstance(`sculptedSegment${k}`));
  const tail = sculpted.body.meshes.tailTip.createInstance("sculptedTail");
  const path = Array.from({ length: SEGMENTS + 1 }, () => new Vector3()); // one point per segment + the tail
  const trail = []; // where the neck has been, newest first

  const flames = createBeastFlames(scene, special, beast.flame, effects);
  const spine = createSpineFlames(scene, special, beast.flame, segments);
  const launch = createLaunch(serpent, special, origin);

  function sync(state, time) {
    const { scale, forward } = poseHead(root, upper, lower, state, special, time, launch.lift(state));
    flames.sync(root.position, forward, scale);

    // Remember the neck's path, and lay the body along it (squeezed while there's little path yet).
    const neck = root.position.subtract(forward.scale(NECK * scale));
    if (trail.length === 0 || Vector3.Distance(neck, trail[0]) >= TRAIL_STEP) {
      trail.unshift(neck.clone());
      trail.length = Math.min(trail.length, Math.ceil((ALONG[SEGMENTS] * 1.5) / TRAIL_STEP) + 2); // forget the rest
    }
    const points = [neck, ...trail];
    let total = 0;
    for (let k = 1; k < points.length; k++) total += Vector3.Distance(points[k - 1], points[k]);
    if (total < 0.3) {
      points.push(points[points.length - 1].subtract(forward.scale(0.3 - total))); // a newborn: 0.3 m straight back
      total = 0.3;
    }
    // While there's less path than body (just out of the wand), the body is squeezed onto it.
    const squeeze = Math.min(1, total / (ALONG[SEGMENTS] * scale));
    path.forEach((point, k) => pointAlong(points, ALONG[k] * scale * squeeze, point));

    path.forEach((point, k) => {
      const s = k / SEGMENTS; // 0 at the neck, 1 at the tail
      point.y += Math.min(1, s * 3) * 0.15 * scale * Math.sin(time * 9 - k * 0.7) - 0.25 * scale * s; // slithering
    });
    segments.forEach((segment, k) => {
      segment.position.copyFrom(path[k]);
      segment.scaling.setAll(scale * SIZES[k]);
      lookTowardHead(segment, k === 0 ? neck : path[k - 1], forward);
    });
    tail.position.copyFrom(path[SEGMENTS]);
    tail.scaling.setAll(scale); // its front already has the last segment's thickness
    lookTowardHead(tail, path[SEGMENTS - 1], forward);
  }
  sync(serpent, 0);

  return {
    sync,
    dispose() {
      flames.stop();
      spine.stop();
      effects.removeWhenDone(spine);
      root.dispose(); // the head pieces under it
      segments.forEach((segment) => segment.dispose());
      tail.dispose();
    },
  };
}

// Puts `out` at `distance` metres along the line through `points` (or at its end).
function pointAlong(points, distance, out) {
  let before = 0;
  for (let k = 0; k < points.length - 1; k++) {
    const span = Vector3.Distance(points[k], points[k + 1]);
    if (before + span >= distance) {
      Vector3.LerpToRef(points[k], points[k + 1], span > 0 ? (distance - before) / span : 0, out);
      return;
    }
    before += span;
  }
  out.copyFrom(points[points.length - 1]);
}

// Turns a body piece so its +z (its front) points at `toward` (the next piece toward the head).
// lookAt() does exactly that; if the two points are on top of each other it keeps the head's direction.
function lookTowardHead(mesh, toward, forward) {
  if (Vector3.DistanceSquared(mesh.position, toward) < 1e-6) {
    mesh.lookAt(mesh.position.add(forward));
  } else {
    mesh.lookAt(toward);
  }
}

// Flames licking up all along the body. startPositionFunction replaces the emitter's own idea of
// where particles are born: here, inside a random body segment.
function createSpineFlames(scene, special, texture, segments) {
  const colors = special.fire.colors.map((hex) => Color3.FromHexString(hex));
  const particles = new ParticleSystem("sculptedSpine", 260, scene);
  particles.particleTexture = texture;
  particles.emitter = new Vector3(0, 0, 0);
  particles.createBoxEmitter(new Vector3(-0.3, 1, -0.3), new Vector3(0.3, 2, 0.3), Vector3.Zero(), Vector3.Zero());
  particles.startPositionFunction = (worldMatrix, position) => {
    const segment = segments[Math.floor(Math.random() * segments.length)];
    const r = 0.22 * segment.scaling.x; // about its half-width
    position.set(
      segment.position.x + (Math.random() * 2 - 1) * r,
      segment.position.y + Math.random() * r,
      segment.position.z + (Math.random() * 2 - 1) * r,
    );
  };
  particles.addColorGradient(0, colors[4].toColor4(0.75));
  particles.addColorGradient(0.3, colors[3].toColor4(0.65));
  particles.addColorGradient(0.65, colors[2].toColor4(0.4));
  particles.addColorGradient(1, colors[1].toColor4(0));
  particles.addSizeGradient(0, 0.4);
  particles.addSizeGradient(0.4, 0.55);
  particles.addSizeGradient(1, 0.1);
  particles.minScaleY = particles.maxScaleY = 1.4; // taller than wide
  particles.minLifeTime = 0.3;
  particles.maxLifeTime = 0.6;
  particles.minEmitPower = 0.6;
  particles.maxEmitPower = 1.2;
  particles.emitRate = 220;
  particles.gravity = new Vector3(0, 4, 0);
  particles.blendMode = ParticleSystem.BLENDMODE_ADD;
  particles.start();
  return particles;
}
