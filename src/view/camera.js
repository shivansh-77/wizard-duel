import { FreeCamera, Vector3 } from "@babylonjs/core";
import { CAMERA } from "../data/camera.js";
import { BOLT_HEIGHT } from "./bolts.js";

// The duel camera, Tekken style. It stands to the side of the line between the two wizards, far
// enough back to frame both, looking a little down at the point halfway between them. As they circle
// each other it turns with them; as they part it backs off; during Priori Incantatem it swoops low
// and close, beside the beams. V switches to the other view: behind your wizard, over his shoulder.
// It reads the rules' state and eases toward the view it wants (the rules can jump, an apparition
// for one: the camera mustn't). The numbers are in data/camera.js.
// `pillars` (TransformNodes) fade out while they stand between the camera and the duel.
export function createCamera(scene, pillars) {
  const camera = new FreeCamera("camera", new Vector3(0, 8, -12), scene);
  camera.fov = toRadians(CAMERA.fov);

  // The view now: which way the camera looks along the floor (yaw: 0 = toward +z, like a wizard's
  // facing), how far back it stands, how far down it looks (pitch), and at what point.
  const now = { yaw: 0, distance: 10, pitch: toRadians(CAMERA.pitch), target: new Vector3(0, CAMERA.targetHeight, 0) };
  let clashMix = 0; // 0 = the normal view, 1 = the clash view; in between while it swoops
  let mode = "side"; // "side" (the duel camera) or "behind" (behind your wizard): V switches
  let you = 0; // which wizard is yours (setPlayer): the first view puts him on the left, "behind" is behind him
  let shake = 0;
  let placed = false; // the first frame jumps straight to the view instead of easing in from nowhere
  const blockers = pillars.map((node) => ({ meshes: node.getChildMeshes(), node, visibility: 1 }));

  // The view the camera wants for this duel state (where it would be if it could jump there): the
  // chosen view, blended toward the clash view during Priori Incantatem. smoothstep eases the swoop
  // in and out instead of starting and stopping abruptly.
  function wanted(duel) {
    const view = mode === "behind" ? behindView(duel) : sideView(duel);
    const ease = clashMix * clashMix * (3 - 2 * clashMix);
    if (ease === 0) return view;
    const clash = clashView(duel);
    return {
      yaw: view.yaw + angleBetween(clash.yaw, view.yaw) * ease,
      distance: view.distance + (clash.distance - view.distance) * ease,
      pitch: view.pitch + (clash.pitch - view.pitch) * ease,
      target: Vector3.Lerp(view.target, clash.target, ease),
    };
  }

  // Where the two wizards are: the line from yours (a) to the other one (b), and its length.
  function measure(duel) {
    const a = duel.wizards[you];
    const b = duel.wizards[1 - you];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return { a, b, dx, dz, separation: Math.max(0.01, Math.hypot(dx, dz)) };
  }

  // Half the camera's sideways view angle. It depends on the window's shape (aspect ratio), so a
  // tall phone screen sees less across and the camera backs off further.
  function halfWidth() {
    return Math.atan(Math.tan(camera.fov / 2) * scene.getEngine().getAspectRatio(camera));
  }

  // The duel camera. Side-on: looking across the line between them. The first view of a duel has
  // your wizard on the left (like player 1 in a fighting game). After that, of the two sides, the
  // one nearer to where the camera already is, so it never swings round just because they passed
  // each other. Far enough back that both fit across the screen, with a margin beyond each.
  function sideView(duel) {
    const { a, b, dx, dz, separation } = measure(duel);
    let yaw = Math.atan2(-dz, dx);
    if (placed && Math.abs(angleBetween(yaw, now.yaw)) > Math.PI / 2 + 0.1) yaw += Math.PI;
    const fit = (separation / 2 + CAMERA.margin) / Math.tan(halfWidth());
    return {
      yaw,
      distance: Math.min(CAMERA.maxDistance, Math.max(CAMERA.minDistance, fit)),
      pitch: toRadians(CAMERA.pitch),
      target: new Vector3((a.x + b.x) / 2, CAMERA.targetHeight, (a.z + b.z) / 2),
    };
  }

  // Priori Incantatem: the side view, low and close and turned a little aside. Turned, one wizard is
  // nearer the camera than the other, so the fit is for the nearer one: across the screen he is
  // half the separation × cos(turn) from the middle, and sin(turn) × that much closer.
  function clashView(duel) {
    const view = sideView(duel);
    const half = measure(duel).separation / 2;
    const turn = toRadians(CAMERA.clash.turn);
    const close = (half * Math.cos(turn) + CAMERA.clash.margin) / Math.tan(halfWidth()) + half * Math.sin(turn);
    view.yaw += turn;
    view.distance = Math.max(CAMERA.minDistance, close);
    view.pitch = toRadians(CAMERA.clash.pitch);
    view.target.y = BOLT_HEIGHT; // level with the beams
    return view;
  }

  // Behind your wizard, over his right shoulder, looking the way he faces (at the other). The camera
  // aims at a point a little ahead of him and to his right, and stands `back` metres behind him:
  // from those, the distance and the pitch follow.
  function behindView(duel) {
    const { a, dx, dz, separation } = measure(duel);
    const { back, height, shoulder, lookAhead, lookHeight } = CAMERA.behind;
    const forward = { x: dx / separation, z: dz / separation };
    const right = { x: forward.z, z: -forward.x }; // his forward turned 90° clockwise
    const ahead = Math.min(lookAhead, separation * 0.6); // Voldemort close: look less far ahead
    const target = new Vector3(
      a.x + forward.x * ahead + right.x * shoulder,
      lookHeight,
      a.z + forward.z * ahead + right.z * shoulder,
    );
    const flat = ahead + back; // from the camera to the target, along the floor
    const rise = height - lookHeight;
    return { yaw: Math.atan2(dx, dz), distance: Math.hypot(flat, rise), pitch: Math.atan2(rise, flat), target };
  }

  // Every frame: ease toward the wanted view, place the camera, shake it, fade pillars in the way.
  function follow(duel, seconds) {
    const goal = duel.clash ? 1 : 0;
    clashMix += Math.sign(goal - clashMix) * Math.min(Math.abs(goal - clashMix), CAMERA.clash.blendSpeed * seconds);

    const view = wanted(duel);
    // A share of the way each second (1 - e^(-rate × time) is the same smooth ease at any frame rate).
    const ease = (rate) => (placed ? 1 - Math.exp(-rate * seconds) : 1);
    now.yaw += angleBetween(view.yaw, now.yaw) * ease(CAMERA.follow.turn);
    now.distance += (view.distance - now.distance) * ease(CAMERA.follow.zoom);
    now.pitch += (view.pitch - now.pitch) * ease(CAMERA.follow.zoom);
    now.target = Vector3.Lerp(now.target, view.target, ease(CAMERA.follow.move));
    placed = true;

    // Back from the target along the floor (against the yaw), and up by the pitch.
    const forward = new Vector3(Math.sin(now.yaw), 0, Math.cos(now.yaw));
    const back = forward.scale(-now.distance * Math.cos(now.pitch));
    camera.position = now.target.add(back).add(new Vector3(0, now.distance * Math.sin(now.pitch), 0));
    camera.setTarget(now.target);

    // Camera shake: the camera jumps a random bit away from its spot, by up to `shake` metres, and the
    // shake fades fast. It moves after setTarget, so the view slides instead of turning.
    // (Math.random is fine here: it's only looks.)
    shake = Math.max(0, shake - CAMERA.shakeFade * seconds);
    const jitter = () => (Math.random() * 2 - 1) * shake;
    camera.position.addInPlace(new Vector3(jitter(), jitter(), jitter()));

    fadeBlockers(duel, seconds);
  }

  // A pillar is in the way if it stands close to the line (seen from above) from the camera to either
  // wizard or to the middle point. mesh.visibility (0 to 1) makes a mesh see-through.
  function fadeBlockers(duel, seconds) {
    const from = camera.position;
    const ends = [...duel.wizards, now.target];
    for (const blocker of blockers) {
      const p = blocker.node.position;
      const inTheWay = ends.some((end) => nearSegment(p, from, end, CAMERA.blocker.width));
      const goal = inTheWay ? CAMERA.blocker.visibility : 1;
      blocker.visibility += (goal - blocker.visibility) * Math.min(1, CAMERA.blocker.fadeSpeed * seconds);
      if (blocker.visibility > 0.99) blocker.visibility = 1; // fully solid again: drawn as opaque
      for (const mesh of blocker.meshes) mesh.visibility = blocker.visibility;
    }
  }

  return {
    camera,
    follow,
    // A new duel: cut straight to its first view instead of flying there.
    reset() {
      placed = false;
      clashMix = 0;
    },
    // Which wizard is yours (0 or 1, the order of duel.wizards). Call reset() after it for a new duel.
    setPlayer(index) {
      you = index;
    },
    // V: the duel camera <-> behind your wizard. It flies to the other view (no cut).
    toggleView() {
      mode = mode === "side" ? "behind" : "side";
      return mode;
    },
    shake(amount) {
      shake = Math.max(shake, amount);
    },
    // The camera's directions along the floor, for screen-relative controls (input/keyboard.js):
    // right = the screen's right, forward = into the screen (away from the camera).
    groundAxes() {
      return {
        right: { x: Math.cos(now.yaw), z: -Math.sin(now.yaw) },
        forward: { x: Math.sin(now.yaw), z: Math.cos(now.yaw) },
      };
    },
  };
}

// The turn from angle b to angle a, the short way round: between -π and π.
function angleBetween(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

// Is point p (x, z) within `width` metres of the segment from `from` to `to`, between its ends?
function nearSegment(p, from, to, width) {
  const sx = to.x - from.x;
  const sz = to.z - from.z;
  const along = ((p.x - from.x) * sx + (p.z - from.z) * sz) / (sx * sx + sz * sz || 1); // 0 at from, 1 at to
  if (along <= 0 || along >= 1) return false;
  return Math.hypot(from.x + along * sx - p.x, from.z + along * sz - p.z) < width;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}
