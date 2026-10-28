import { MeshBuilder, Vector3 } from "@babylonjs/core";
import { SPECIALS } from "../data/spells.js";
import { LAUNCH_DISTANCE } from "./bolts.js";

// Fiendfyre's step-16 look ("caterpillar" in data/spells.js): a small head of fire with glowing eyes,
// and a body: a tube of fire that follows the head's trail. Kept as a look you can switch back to;
// the default is now the beast (view/fiendfyre_beast.js).

const BODY_POINTS = 26; // points along the body
const BODY_LENGTH = 4; // metres from the head to the tip of the tail
const MIN_BODY = 0.3; // a newborn serpent still gets this much body (a tube needs some length)
const TRAIL_STEP = 0.1; // the view remembers where its head was every this many metres
const HEAD_HEIGHT = 0.7; // the head slithers this high above the platform

// The view remembers where the head has been (a point every TRAIL_STEP metres) and lays the body
// along those points, so it bends wherever the serpent turned. Like a bolt, the head leaves the real
// wand tip (`origin`) and glides onto the rules' path over its first LAUNCH_DISTANCE metres; the
// body grows out of the wand behind it.
export function createCaterpillar(scene, serpent, duel, { fire, headFire, eyes, glow, effects }, origin) {
  const special = SPECIALS[duel.wizards[serpent.owner].data.special];
  const head = createHead(scene, headFire, eyes, glow);
  head.position.copyFrom(origin);
  head.rotation.y = serpent.heading;
  const start = { x: serpent.x, z: serpent.z };
  const offset = origin.subtract(new Vector3(serpent.x, HEAD_HEIGHT, serpent.z));
  let fade = 1; // 1 at the wand, 0 once it has slithered LAUNCH_DISTANCE; it only goes down

  const trail = [origin.clone()]; // where the drawn head has been, newest first
  const path = Array.from({ length: BODY_POINTS }, () => new Vector3());
  let bodyLength = layBody(path, head.position, trail, serpent.heading, 0);
  // A slim neck (so the head stands out), swelling to its thickest a fifth of the way back, then
  // tapering to the tail. A newborn serpent (short body) is thinner all over.
  const radiusFunction = (i) => {
    const s = i / (BODY_POINTS - 1); // 0 at the neck, 1 at the tail
    const swell = s < 0.2 ? 0.55 + 0.45 * (s / 0.2) : Math.pow((1 - s) / 0.8, 0.9);
    const grown = Math.min(1, 0.35 + bodyLength / BODY_LENGTH);
    return (0.03 + 0.16 * swell) * grown;
  };
  const body = MeshBuilder.CreateTube("serpentBody", { path, radiusFunction, tessellation: 14, updatable: true }, scene);
  body.material = fire;
  glow(body);

  const flames = effects.fountain(special.color, 140); // sparks spitting from its head
  flames.start();

  return {
    sync(state, time) {
      const travelled = Math.hypot(state.x - start.x, state.z - start.z);
      fade = Math.min(fade, Math.max(0, 1 - travelled / LAUNCH_DISTANCE));
      head.position.set(state.x, HEAD_HEIGHT, state.z).addInPlace(offset.scale(fade));
      head.rotation.y = state.heading;
      if (Vector3.Distance(head.position, trail[0]) >= TRAIL_STEP) {
        trail.unshift(head.position.clone());
        trail.length = Math.min(trail.length, Math.ceil(BODY_LENGTH / TRAIL_STEP) + 2); // forget the rest
      }
      bodyLength = layBody(path, head.position, trail, state.heading, time);
      MeshBuilder.CreateTube(body.name, { path, radiusFunction, instance: body });
      flames.emitter.copyFrom(head.position);
    },
    dispose() {
      flames.stop();
      effects.removeWhenDone(flames); // let the last sparks fade first
      head.dispose(); // its eyes too (children are disposed with their parent)
      body.dispose();
    },
  };
}

// A snake's head: a ball stretched long and flat, made of the fire, with two glowing eyes.
function createHead(scene, fire, eyes, glow) {
  const head = MeshBuilder.CreateSphere("serpentHead", { diameter: 0.7, segments: 16 }, scene);
  head.scaling.set(0.85, 0.6, 1.45); // its front is +z: rotation.y = heading points it where it goes
  head.material = fire;
  glow(head);
  for (const side of [-1, 1]) {
    const eye = MeshBuilder.CreateSphere("serpentEye", { diameter: 0.1, segments: 8 }, scene);
    eye.material = eyes;
    eye.parent = head; // follows the head; positions are in the head's own (unstretched) space
    eye.position.set(0.19 * side, 0.16, 0.26); // on top, toward the front, sticking out a little
  }
  return head;
}

// Lays the body: BODY_POINTS points spread evenly from the head back along the trail, over at most
// BODY_LENGTH metres. A trail shorter than MIN_BODY (just leapt out of the wand) is stretched
// straight back behind the head. Then each point bobs on a wave running down the body (slithering)
// and the tail sinks a little. Fills `path`; returns the body's length.
function layBody(path, headPosition, trail, heading, time) {
  const points = [headPosition, ...trail];
  let total = 0;
  for (let k = 1; k < points.length; k++) total += Vector3.Distance(points[k - 1], points[k]);
  if (total < MIN_BODY) {
    const back = new Vector3(-Math.sin(heading), 0, -Math.cos(heading));
    points.push(points[points.length - 1].add(back.scale(MIN_BODY - total)));
    total = MIN_BODY;
  }
  const length = Math.min(BODY_LENGTH, total);
  spreadAlong(path, points, length);
  path.forEach((point, i) => {
    const s = i / (BODY_POINTS - 1); // 0 at the neck, 1 at the tail
    point.y += Math.min(1, s * 4) * 0.12 * Math.sin(time * 12 - i * 0.5) - 0.2 * s;
  });
  return length;
}

// Puts path's points evenly along the line through `points`, over its first `length` metres.
function spreadAlong(path, points, length) {
  let k = 0; // the segment from points[k] to points[k + 1]
  let before = 0; // the distance along the line where that segment starts
  for (let i = 0; i < path.length; i++) {
    const wanted = (length * i) / (path.length - 1);
    let span = Vector3.Distance(points[k], points[k + 1]);
    while (before + span < wanted && k < points.length - 2) {
      before += span;
      k++;
      span = Vector3.Distance(points[k], points[k + 1]);
    }
    const t = span > 0 ? Math.min(1, (wanted - before) / span) : 0;
    Vector3.LerpToRef(points[k], points[k + 1], t, path[i]);
  }
}
