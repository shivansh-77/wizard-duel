import { ARENA } from "../data/arena.js";
import { BEAMING, BOLTS, SPECIALS } from "../data/spells.js";
import { strike } from "./combat.js";
import { STEP_SECONDS } from "./fixed_step.js";
import { angleBetween, angleOf, direction, distanceToSegment, forward, toRadians, wandTip } from "./geometry.js";

// The specials: one big move per wizard, each run by its own "engine", like Alien Fight's
// special-move engines. data/spells.js says which engine a special uses (`kind`) and gives its numbers.

// Called by game/duel.js when a special's wind-up is over.
export function releaseSpecial(duel, wizard) {
  const special = SPECIALS[wizard.data.special];
  if (special.kind === "whip") startWhip(duel, wizard);
  if (special.kind === "serpent") releaseSerpent(duel, wizard, special);
}

// Every step: whips that are sweeping and serpents that are hunting.
export function updateSpecials(duel) {
  for (const wizard of duel.wizards) {
    if (wizard.whip) updateWhip(duel, wizard);
  }
  for (const serpent of duel.serpents) updateSerpent(duel, serpent);
  duel.serpents = duel.serpents.filter((serpent) => !serpent.gone);
  duel.bolts = duel.bolts.filter((bolt) => !bolt.gone); // serpents can put out bolts too
}

function canBeHurt(duel, wizard) {
  return duel.phase === "fight" && wizard.transit === 0 && !wizard.down;
}

// ---- The fire whip: a lash of fire swinging around him, from his right to his left ----

// whip.angle is where the lash points now; it starts `arc / 2` to the right of where he faces and
// ends `arc / 2` to the left. He turns with it, so his wand arm follows the lash.
function startWhip(duel, wizard) {
  const special = SPECIALS[wizard.data.special];
  wizard.whip = { time: 0, center: wizard.facing, angle: wizard.facing + toRadians(special.arc) / 2, hit: false };
  duel.events.push({ type: "whip", wizard: wizard.index });
}

function updateWhip(duel, wizard) {
  const special = SPECIALS[wizard.data.special];
  const whip = wizard.whip;
  const before = whip.angle;
  whip.time += STEP_SECONDS;
  const progress = Math.min(1, whip.time / special.sweepTime); // 0 → 1 during the sweep
  whip.angle = whip.center + toRadians(special.arc) * (0.5 - progress);
  wizard.facing = whip.angle;

  // The other wizard: hit once, if the lash passed over him this step.
  const target = duel.wizards[1 - wizard.index];
  if (!whip.hit && canBeHurt(duel, target) && swept(wizard, before, whip.angle, special.reach, target, target.data.bodyRadius)) {
    whip.hit = true;
    if (target.shieldUp) {
      duel.events.push({ type: "block", wizard: target.index, x: target.x, z: target.z });
    } else {
      // The lash throws him sideways, the way it's swinging, and a little outward.
      const out = forward(whip.angle);
      const across = { x: -out.z, z: out.x }; // the swing's direction: toward smaller angles
      const length = Math.hypot(across.x + 0.6 * out.x, across.z + 0.6 * out.z);
      const push = { x: (across.x + 0.6 * out.x) / length, z: (across.z + 0.6 * out.z) / length };
      duel.events.push({ type: "hit", wizard: target.index, color: special.color, x: target.x, z: target.z });
      strike(duel, target, { damage: special.damage, push, knockback: special.knockback, stun: special.stun, stopSteps: special.stopSteps });
    }
  }
  // Fiendfyre caught by the lash is put out.
  for (const serpent of duel.serpents) {
    if (!serpent.gone && serpent.owner !== wizard.index && swept(wizard, before, whip.angle, special.reach, serpent, serpent.radius)) {
      putOut(duel, serpent);
    }
  }
  if (progress >= 1) wizard.whip = null;
}

// Whether a lash swinging around `origin` from angle `from` down to angle `to` passed over a round
// thing (anything with x and z) of this radius, within `reach` of the origin.
function swept(origin, from, to, reach, thing, radius) {
  const dx = thing.x - origin.x;
  const dz = thing.z - origin.z;
  const distance = Math.hypot(dx, dz);
  if (distance > reach + radius) return false;
  const halfWidth = Math.atan2(radius, Math.max(distance, 0.01)); // how wide it looks from the origin, as an angle
  const where = angleBetween(to, angleOf(dx, dz)); // its angle, measured from the lash's new angle
  const moved = angleBetween(to, from); // how far the lash swung this step
  return where >= -halfWidth && where <= moved + halfWidth;
}

// ---- Fiendfyre: a huge serpent of cursed fire that hunts the other wizard ----

// It leaves the wand heading sideways, swings round to him on a big arc (a semicircle from far
// away), lines up on him `lunge` metres out and lunges straight at him, growing all the while.
// The arc bulges toward the arena's centre, where the round platform has room.
function releaseSerpent(duel, wizard, special) {
  const tip = wandTip(wizard, forward(wizard.facing));
  const target = duel.wizards[1 - wizard.index];
  const distance = Math.max(0.1, Math.hypot(target.x - tip.x, target.z - tip.z));
  const side = arcSide(wizard, target);
  // Up close there's less room to swing round: closer than twice the lunge distance the arc is
  // flatter, and from the lunge distance or closer it just lunges.
  const arc = toRadians(special.arc) * Math.max(0, Math.min(1, distance / special.lunge - 1));
  duel.serpents.push({
    owner: wizard.index,
    x: tip.x,
    z: tip.z,
    heading: angleOf(target.x - tip.x, target.z - tip.z) + side * arc, // off to one side of him
    radius: special.startRadius, // its head, for hitting: it grows (updateSerpent)
    side, // +1: the arc bulges to the caster's right, -1: to his left
    arc, // radians: how far to the side of the line to him it left the wand
    swing: arc, // radians: how far to the side it flies now (0 once it lunges)
    startDistance: distance, // metres from the wand tip to him
    arcLength: arc > 0 ? (arc * distance) / Math.sin(arc) : 0, // metres along a circular arc to him
    travelled: 0, // metres flown so far
    age: 0,
    toughness: special.toughness,
    gone: false,
  });
  duel.events.push({ type: "serpent", wizard: wizard.index, x: tip.x, z: tip.z });
}

// Which way the arc bulges: +1 = to the caster's right, -1 = to his left. Toward the side of the
// line between them where the arena's centre is. When the centre is (almost) on that line, like at
// the start, both sides have the same room: then his left. (Any choice is fair; at the opening
// positions his left is the side the duel camera starts on, so the beast swings round toward you,
// face first. The rules still never read the camera.)
const SIDE_TIE = 0.25; // metres: "almost on the line"
function arcSide(caster, target) {
  const dir = direction(caster, target);
  const right = { x: dir.z, z: -dir.x }; // dir turned 90° clockwise, as in wandTip
  const centreToRight = -caster.x * right.x - caster.z * right.z; // how far the centre (0, 0) is to his right
  if (Math.abs(centreToRight) < SIDE_TIE) return -1;
  return centreToRight > 0 ? 1 : -1;
}

// How far to the side of the line to him the serpent should fly now (radians), while it swings.
// On a circular arc that angle shrinks evenly with the distance flown, from `arc` at the wand to 0
// at the target (on a semicircle: from 90° to 0). But it lunges from `lunge` metres out, so the
// swing also shrinks as it closes in, reaching 0 at the lunge distance. The smaller one wins, so
// if he runs at it the swing tightens and it still comes for him. It only ever shrinks.
function swingAngle(serpent, special, toTarget) {
  if (serpent.swing === 0) return 0;
  // Near the platform's edge (within 0.5 m) and heading out over it (if he moved, the arc can
  // swing wide), it cuts the swing short and lunges. Outward = its heading points away from the
  // centre: the dot product of its heading and its position is positive.
  const outward = Math.sin(serpent.heading) * serpent.x + Math.cos(serpent.heading) * serpent.z > 0;
  if (outward && Math.hypot(serpent.x, serpent.z) > ARENA.radius - 0.5) return 0;
  const alongArc = 1 - serpent.travelled / serpent.arcLength;
  const closingIn = (toTarget - special.lunge) / (serpent.startDistance - special.lunge);
  return Math.min(serpent.swing, serpent.arc * Math.max(0, Math.min(alongArc, closingIn)));
}

// 0 → 1 with a gentle start and end, for t from 0 to 1 (outside, it stays at 0 or 1).
function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function updateSerpent(duel, serpent) {
  if (serpent.gone) return;
  const special = SPECIALS[duel.wizards[serpent.owner].data.special];
  const target = duel.wizards[1 - serpent.owner];

  const toTarget = Math.hypot(target.x - serpent.x, target.z - serpent.z);
  const lineToHim = angleOf(target.x - serpent.x, target.z - serpent.z);
  serpent.swing = swingAngle(serpent, special, toTarget);
  if (serpent.swing > 0) {
    // Swinging round: it flies `swing` to the side of the line to him, so it keeps him in view
    // wherever he goes. The swing is the spell's shape: moving early doesn't shake it off.
    serpent.heading = lineToHim + serpent.side * serpent.swing;
  } else {
    // The lunge: straight at him, but never turning faster than turnRate. A sidestep now swings
    // him round faster than it can turn, and it shoots past.
    const maxTurn = toRadians(special.turnRate) * STEP_SECONDS;
    serpent.heading += Math.max(-maxTurn, Math.min(maxTurn, angleBetween(serpent.heading, lineToHim)));
  }
  const dir = forward(serpent.heading);
  serpent.x += dir.x * special.speed * STEP_SECONDS;
  serpent.z += dir.z * special.speed * STEP_SECONDS;
  serpent.travelled += special.speed * STEP_SECONDS;
  serpent.age += STEP_SECONDS;
  // It grows as it closes in, from startRadius to endRadius over growTime (never shrinking).
  const growth = smoothstep(serpent.age / special.growTime);
  serpent.radius = special.startRadius + (special.endRadius - special.startRadius) * growth;

  if (serpent.age >= special.lifetime || Math.hypot(serpent.x, serpent.z) > ARENA.radius + 1) {
    putOut(duel, serpent);
    return;
  }
  // Bolts put it out: it takes `toughness` of them.
  for (const bolt of duel.bolts) {
    if (bolt.gone || bolt.owner === serpent.owner) continue;
    if (Math.hypot(bolt.x - serpent.x, bolt.z - serpent.z) < BOLTS[bolt.spell].radius + serpent.radius) {
      bolt.gone = true;
      serpent.toughness -= 1;
      duel.events.push({ type: "fizzle", color: BOLTS[bolt.spell].color, x: bolt.x, z: bolt.z });
      if (serpent.toughness <= 0) {
        putOut(duel, serpent);
        return;
      }
    }
  }
  // The target's beam swallows it.
  if (target.beamStart && distanceToSegment(serpent, target.beamStart, target.beamEnd) < BEAMING.swallowRadius) {
    putOut(duel, serpent);
    return;
  }
  // It reaches the target: Protego stops it, otherwise it bites.
  const touching = Math.hypot(target.x - serpent.x, target.z - serpent.z) < serpent.radius + target.data.bodyRadius;
  if (touching && canBeHurt(duel, target)) {
    serpent.gone = true;
    if (target.shieldUp) {
      duel.events.push({ type: "block", wizard: target.index, x: serpent.x, z: serpent.z });
      return;
    }
    duel.events.push({ type: "hit", wizard: target.index, color: special.color, x: serpent.x, z: serpent.z });
    strike(duel, target, { damage: special.damage, push: dir, knockback: special.knockback, stun: special.stun, stopSteps: special.stopSteps });
  }
}

function putOut(duel, serpent) {
  serpent.gone = true;
  const color = SPECIALS[duel.wizards[serpent.owner].data.special].color;
  duel.events.push({ type: "fireOut", color, x: serpent.x, z: serpent.z });
}
