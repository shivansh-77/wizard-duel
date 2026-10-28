import { ARENA } from "../data/arena.js";
import { APPARATE, BEAMING, BEAMS, BOLTS, CASTING, CLASH, HIT, PROTEGO, SPECIALS } from "../data/spells.js";
import { damage, stopBeam, strike } from "./combat.js";
import { STEP_SECONDS } from "./fixed_step.js";
import { angleOf, direction, distanceToSegment, forward, wandTip } from "./geometry.js";
import { releaseSpecial, updateSpecials } from "./specials.js";

// The duel's rules. Plain numbers only: no Babylon, no keyboard, no real time. The view reads this
// state to draw the duel, and takes the `events` out every frame (a cast, a hit, a KO...) to play
// effects and sounds. It never changes the state. The specials have their own file (specials.js),
// and so does getting hurt (combat.js).

const GLIDE_RESPONSE = 10; // how quickly the velocity catches up with the input (per second): lower = floatier
const BUTTONS = ["cast", "shield", "apparate", "beam", "special"];
const NO_INPUT = { x: 0, z: 0, cast: false, shield: false, apparate: false, beam: false, special: false };

// The starting state: one entry per wizard, built from his data (data/wizards.js).
export function createDuel(wizards) {
  const duel = {
    wizards: wizards.map((data, index) => ({
      data, // speed, bodyRadius, maxHealth, bolt, beam, special... (only read, never changed)
      index, // 0 or 1: events say "wizard: index"
      x: data.start.x, // position on the platform, in metres from its centre
      z: data.start.z,
      vx: 0, // velocity, in metres per second
      vz: 0,
      facing: 0, // radians: the way he looks (0 = +z, Babylon's "forward")
      health: data.maxHealth,
      down: false, // knocked out
      castTimer: 0, // wind-up left before the bolt leaves the wand (0 = not casting)
      castCooldown: 0,
      shieldUp: false,
      shieldTime: 0, // how long the shield has been up
      shieldCooldown: 0,
      transit: 0, // apparating: time left "in between"
      destination: null, // where he'll reappear
      apparateCooldown: 0,
      beamTimer: 0, // wind-up left before the beam bursts out (0 = not starting one)
      beamCooldown: 0,
      beaming: false, // his beam is flowing
      beamTime: 0, // how long it has been flowing
      beamDir: null, // { x, z }: where the beam points, fixed when its wind-up starts
      beamStart: null, // { x, z }: where it leaves the wand...
      beamEnd: null, // ...and where it stops (for the view)
      beamContact: null, // { x, z, blocked }: where it touches the other wizard, or his shield
      specialTimer: 0, // wind-up left before his special (0 = not starting one)
      specialCooldown: 0,
      whip: null, // the fire whip while it sweeps: { time, center, angle, hit } (specials.js)
      stun: 0, // knocked back: he can't act until this runs out
      wasHeld: Object.fromEntries(BUTTONS.map((button) => [button, false])), // last step's buttons, to spot presses
    })),
    bolts: [], // { owner, spell, x, z, vx, vz, age }
    serpents: [], // Fiendfyre: { owner, x, z, heading, radius, side, arc, swing, age, toughness... } (specials.js)
    clash: null, // Priori Incantatem, while two beams are locked: { balance, time, point }
    hitStop: 0, // steps left in a hit-stop freeze
    phase: "fight", // "fight", then "over" after a KO
    winner: null, // the winner's index
    events: [], // what just happened, for the view (it empties this list every frame)
  };
  faceEachOther(duel);
  return duel;
}

// Advances the duel by one fixed step. inputs[i] is wizard i's { x, z, cast, shield, apparate, beam,
// special }: x and z between -1 and 1 (input/keyboard.js, or game/cpu.js), the rest are "held" booleans.
export function stepDuel(duel, inputs) {
  // Hit-stop: after a clean hit, everything freezes for a few steps so the hit feels heavy.
  if (duel.hitStop > 0) {
    duel.hitStop--;
    return;
  }
  const inputOf = (wizard) => (duel.phase === "fight" && !wizard.down ? inputs[wizard.index] : NO_INPUT);
  if (duel.clash) {
    updateClash(duel, duel.wizards.map(inputOf));
  } else {
    for (const wizard of duel.wizards) updateWizard(duel, wizard, inputOf(wizard));
    if (!duel.clash) updateBeams(duel); // a clash that just started has placed the beams itself
  }
  moveBolts(duel);
  updateSpecials(duel);

  const [a, b] = duel.wizards;
  keepOnPlatform(a);
  keepOnPlatform(b);
  // Last, so bodies never overlap. Pinned against the edge, a wizard can end up a few cm past the
  // limit: too little to see.
  keepApart(a, b);
  faceEachOther(duel);
}

// ---- One wizard's step: timers, buttons, actions, then gliding ----

function updateWizard(duel, wizard, input) {
  tickTimers(wizard);
  const pressed = readPresses(wizard, input);

  if (wizard.transit > 0) {
    // Apparating: "in between" until the transit time runs out, then he reappears.
    wizard.transit -= STEP_SECONDS;
    if (wizard.transit <= 0) arrive(duel, wizard);
    return;
  }
  if (wizard.beaming || wizard.whip) {
    glide(wizard, NO_INPUT, 1); // a flowing beam or a sweeping whip roots him (updateBeams / specials.js run them)
    return;
  }

  const canAct = wizard.stun === 0;
  updateShield(duel, wizard, canAct && pressed.shield, input.shield);

  const windingUp = wizard.castTimer > 0 || wizard.beamTimer > 0 || wizard.specialTimer > 0;
  if (canAct && pressed.apparate && wizard.apparateCooldown === 0 && wizard.beamTimer === 0 && wizard.specialTimer === 0) {
    startApparate(duel, wizard, input);
    return;
  }
  const busy = wizard.shieldUp || windingUp;
  if (canAct && pressed.special && wizard.specialCooldown === 0 && !busy) {
    const special = SPECIALS[wizard.data.special];
    wizard.specialTimer = special.windUp;
    wizard.specialCooldown = special.cooldown;
  } else if (canAct && pressed.beam && wizard.beamCooldown === 0 && !busy) {
    // The beam's aim is fixed now, at the start of the wind-up: the wind-up is your warning to move.
    wizard.beamTimer = BEAMING.windUp;
    wizard.beamCooldown = BEAMING.cooldown;
    wizard.beamDir = forward(wizard.facing);
  } else if (canAct && pressed.cast && wizard.castCooldown === 0 && !busy) {
    wizard.castTimer = CASTING.windUp;
    wizard.castCooldown = CASTING.cooldown;
  }

  if (wizard.castTimer > 0) {
    wizard.castTimer -= STEP_SECONDS;
    if (wizard.castTimer <= 0) {
      wizard.castTimer = 0;
      releaseBolt(duel, wizard);
    }
  }
  if (wizard.beamTimer > 0 || wizard.specialTimer > 0) {
    // Winding up a beam or a special: he stands still, gathering it.
    if (wizard.beamTimer > 0) {
      wizard.beamTimer -= STEP_SECONDS;
      if (wizard.beamTimer <= 0) {
        wizard.beamTimer = 0;
        startBeam(duel, wizard);
      }
    } else {
      wizard.specialTimer -= STEP_SECONDS;
      if (wizard.specialTimer <= 0) {
        wizard.specialTimer = 0;
        releaseSpecial(duel, wizard);
      }
    }
    glide(wizard, NO_INPUT, 1);
    return;
  }

  glide(wizard, canAct ? input : NO_INPUT, wizard.shieldUp ? PROTEGO.moveFactor : 1);
}

function tickTimers(wizard) {
  for (const timer of ["castCooldown", "shieldCooldown", "apparateCooldown", "beamCooldown", "specialCooldown", "stun"]) {
    wizard[timer] = Math.max(0, wizard[timer] - STEP_SECONDS);
  }
}

// A press = held now but not last step, so holding a button doesn't repeat it.
function readPresses(wizard, input) {
  const pressed = {};
  for (const button of BUTTONS) {
    pressed[button] = Boolean(input[button]) && !wizard.wasHeld[button];
    wizard.wasHeld[button] = Boolean(input[button]);
  }
  return pressed;
}

function glide(wizard, input, speedFactor) {
  // The wanted direction. A diagonal like (1, 1) is longer than 1 (√2 ≈ 1.41), so shrink it
  // back to length 1, or gliding diagonally would be 41% faster.
  let { x, z } = input;
  const length = Math.hypot(x, z);
  if (length > 1) {
    x /= length;
    z /= length;
  }

  // The velocity eases toward the wanted velocity instead of jumping to it, so the wizard
  // speeds up smoothly and drifts to a stop, like he's floating.
  const speed = wizard.data.speed * speedFactor;
  const ease = Math.min(1, GLIDE_RESPONSE * STEP_SECONDS);
  wizard.vx += (x * speed - wizard.vx) * ease;
  wizard.vz += (z * speed - wizard.vz) * ease;

  wizard.x += wizard.vx * STEP_SECONDS;
  wizard.z += wizard.vz * STEP_SECONDS;
}

// ---- Bolts ----

// The bolt leaves the wand tip and flies straight ahead: aiming is done by facing (lock-on), so
// the way to escape a bolt is to glide out of its path.
function releaseBolt(duel, wizard) {
  const spell = BOLTS[wizard.data.bolt];
  const ahead = forward(wizard.facing);
  const { x, z } = wandTip(wizard, ahead);
  duel.bolts.push({
    owner: wizard.index,
    spell: wizard.data.bolt,
    x,
    z,
    vx: ahead.x * spell.speed,
    vz: ahead.z * spell.speed,
    age: 0,
  });
  duel.events.push({ type: "cast", wizard: wizard.index, spell: wizard.data.bolt, x, z });
}

function moveBolts(duel) {
  for (const bolt of duel.bolts) {
    bolt.x += bolt.vx * STEP_SECONDS;
    bolt.z += bolt.vz * STEP_SECONDS;
    bolt.age += STEP_SECONDS;
    if (bolt.age >= BOLTS[bolt.spell].lifetime) bolt.gone = true;

    for (const wizard of duel.wizards) {
      if (bolt.gone || wizard.index === bolt.owner) continue;
      // A flowing beam swallows the other wizard's bolts that come close to it (BEAMING.swallowRadius).
      if (wizard.beamStart) {
        if (distanceToSegment(bolt, wizard.beamStart, wizard.beamEnd) < BEAMING.swallowRadius) {
          bolt.gone = true;
          duel.events.push({ type: "fizzle", color: BOLTS[bolt.spell].color, x: bolt.x, z: bolt.z });
          continue;
        }
      }
      if (wizard.transit > 0 || wizard.down || duel.phase !== "fight") continue;
      // Both are circles seen from above: they touch when the distance between their centres is
      // less than the two radii added together.
      const touching = Math.hypot(wizard.x - bolt.x, wizard.z - bolt.z) < wizard.data.bodyRadius + BOLTS[bolt.spell].radius;
      if (touching) boltMeetsWizard(duel, bolt, wizard);
    }
  }
  duel.bolts = duel.bolts.filter((bolt) => !bolt.gone);
}

function boltMeetsWizard(duel, bolt, wizard) {
  if (wizard.shieldUp) {
    if (wizard.shieldTime <= PROTEGO.reflectWindow) {
      // Perfect timing: the bolt turns around and flies at its caster, and now belongs to the
      // wizard who reflected it.
      const caster = duel.wizards[bolt.owner];
      const speed = Math.hypot(bolt.vx, bolt.vz);
      const back = direction(bolt, caster);
      bolt.vx = back.x * speed;
      bolt.vz = back.z * speed;
      bolt.owner = wizard.index;
      bolt.age = 0;
      duel.events.push({ type: "reflect", wizard: wizard.index, x: bolt.x, z: bolt.z });
    } else {
      bolt.gone = true;
      duel.events.push({ type: "block", wizard: wizard.index, x: bolt.x, z: bolt.z });
    }
    return;
  }
  bolt.gone = true;
  const spell = BOLTS[bolt.spell];
  const speed = Math.hypot(bolt.vx, bolt.vz);
  duel.events.push({ type: "hit", wizard: wizard.index, color: spell.color, x: bolt.x, z: bolt.z });
  strike(duel, wizard, {
    damage: spell.damage,
    push: { x: bolt.vx / speed, z: bolt.vz / speed }, // knocked back along the bolt's path
    knockback: spell.knockback,
    stun: HIT.stun,
    stopSteps: HIT.stopSteps,
  });
}

// ---- Protego and Apparate ----

// Protego: a press raises it (not while winding anything up, or cooling down); it stays up while
// the button is held, up to maxHold.
function updateShield(duel, wizard, pressedNow, held) {
  if (wizard.shieldUp) {
    wizard.shieldTime += STEP_SECONDS;
    if (!held || wizard.shieldTime >= PROTEGO.maxHold) {
      wizard.shieldUp = false;
      wizard.shieldCooldown = PROTEGO.cooldown;
    }
  } else if (pressedNow && wizard.shieldCooldown === 0 && wizard.castTimer === 0 && wizard.beamTimer === 0 && wizard.specialTimer === 0) {
    wizard.shieldUp = true;
    wizard.shieldTime = 0;
    duel.events.push({ type: "shield", wizard: wizard.index, x: wizard.x, z: wizard.z });
  }
}

// Apparate: vanish now, reappear APPARATE.distance away once the transit time is over. He goes
// where he's gliding, or to his right if he's standing still.
function startApparate(duel, wizard, input) {
  let dx = input.x;
  let dz = input.z;
  if (dx === 0 && dz === 0) {
    dx = Math.cos(wizard.facing); // his right (his forward turned 90° clockwise)
    dz = -Math.sin(wizard.facing);
  }
  const length = Math.hypot(dx, dz);
  const destination = {
    x: wizard.x + (dx / length) * APPARATE.distance,
    z: wizard.z + (dz / length) * APPARATE.distance,
  };
  clampToPlatform(destination, wizard.data.bodyRadius);

  duel.events.push({ type: "vanish", wizard: wizard.index, x: wizard.x, z: wizard.z });
  wizard.destination = destination;
  wizard.transit = APPARATE.transit;
  wizard.apparateCooldown = APPARATE.cooldown;
  wizard.shieldUp = false; // apparating drops the shield and cancels a cast
  wizard.castTimer = 0;
  wizard.vx = 0;
  wizard.vz = 0;
}

function arrive(duel, wizard) {
  wizard.transit = 0;
  wizard.x = wizard.destination.x;
  wizard.z = wizard.destination.z;
  wizard.destination = null;
  duel.events.push({ type: "appear", wizard: wizard.index, x: wizard.x, z: wizard.z });
}

// ---- The beam ----

// The beam bursts out along the aim fixed at its wind-up. If the other wizard's beam is already
// flowing, the two lock together: Priori Incantatem.
function startBeam(duel, wizard) {
  wizard.beaming = true;
  wizard.beamTime = 0;
  duel.events.push({ type: "beam", wizard: wizard.index });
  if (duel.wizards[1 - wizard.index].beaming) startClash(duel);
}

// Every step a beam flows (outside a clash): it runs out after BEAMING.duration. Otherwise it
// reaches its full length, or stops where it touches the other wizard (hurting him) or his shield.
function updateBeams(duel) {
  for (const wizard of duel.wizards) {
    if (!wizard.beaming) continue;
    wizard.beamTime += STEP_SECONDS;
    if (wizard.beamTime >= BEAMING.duration) {
      stopBeam(wizard);
      duel.events.push({ type: "beamEnd", wizard: wizard.index });
      continue;
    }
    const beam = BEAMS[wizard.data.beam];
    const dir = wizard.beamDir;
    const start = wandTip(wizard, dir);
    let length = beam.length;
    wizard.beamContact = null;

    const target = duel.wizards[1 - wizard.index];
    if (target.transit === 0 && !target.down) {
      // Seen from above: how far along the beam the target's centre is, and how far to its side.
      const along = (target.x - start.x) * dir.x + (target.z - start.z) * dir.z;
      const aside = Math.abs((target.x - start.x) * dir.z - (target.z - start.z) * dir.x);
      const radius = target.shieldUp ? PROTEGO.radius : target.data.bodyRadius;
      if (along > 0 && along < length && aside < radius + beam.width / 2) {
        // The beam stops where it meets the edge of that circle, a little before its centre.
        length = Math.max(0, along - Math.sqrt(Math.max(0, radius * radius - aside * aside)));
        const blocked = target.shieldUp;
        wizard.beamContact = { x: start.x + dir.x * length, z: start.z + dir.z * length, blocked };
        if (!blocked) damage(duel, target, beam.damagePerSecond * STEP_SECONDS);
      }
    }
    if (!wizard.beaming) continue; // that damage knocked the target out, which stopped every beam
    wizard.beamStart = start;
    wizard.beamEnd = { x: start.x + dir.x * length, z: start.z + dir.z * length };
  }
}

// ---- Priori Incantatem: the clash ----

// The two beams lock wand to wand. The meeting point sits between the two wand tips, and `balance`
// says where: -1 at wizard 0's wand, 0 in the middle, +1 at wizard 1's wand. Each press of cast
// (or beam) pushes it toward the other wizard; whoever has it reach his own wand loses.
function startClash(duel) {
  duel.clash = { balance: 0, time: 0, point: null };
  for (const wizard of duel.wizards) {
    wizard.vx = 0; // locked in place
    wizard.vz = 0;
    wizard.castTimer = 0;
    wizard.shieldUp = false;
    wizard.beamContact = null;
  }
  placeClashPoint(duel);
  duel.events.push({ type: "clash", x: duel.clash.point.x, z: duel.clash.point.z });
}

function updateClash(duel, inputs) {
  const clash = duel.clash;
  const pushes = duel.wizards.map((wizard, i) => {
    tickTimers(wizard);
    const pressed = readPresses(wizard, inputs[i]);
    return pressed.cast || pressed.beam ? 1 : 0;
  });
  clash.balance += CLASH.pushPerPress * (pushes[0] - pushes[1]); // wizard 0 pushes toward +1, wizard 1 toward -1
  clash.time += STEP_SECONDS;
  placeClashPoint(duel);
  pushes.forEach((push, i) => {
    if (push) duel.events.push({ type: "push", wizard: i, x: clash.point.x, z: clash.point.z });
  });
  if (Math.abs(clash.balance) >= 1 || clash.time >= CLASH.maxTime) endClash(duel);
}

// Puts the meeting point on the line between the two wand tips (both point straight at each other).
function placeClashPoint(duel) {
  const [a, b] = duel.wizards;
  const toB = direction(a, b);
  const tipA = wandTip(a, toB);
  const tipB = wandTip(b, { x: -toB.x, z: -toB.z });
  const t = (Math.max(-1, Math.min(1, duel.clash.balance)) + 1) / 2; // 0 at a's wand, 1 at b's
  const point = { x: tipA.x + (tipB.x - tipA.x) * t, z: tipA.z + (tipB.z - tipA.z) * t };
  duel.clash.point = point;
  a.beamStart = tipA;
  a.beamEnd = point;
  b.beamStart = tipB;
  b.beamEnd = point;
}

// The clash explodes on the wizard whose side the meeting point is on: damage, a big knockback and
// a long hit-stop. A win on time hurts less than pushing it all the way.
function endClash(duel) {
  const { balance, point } = duel.clash;
  duel.clash = null;
  for (const wizard of duel.wizards) stopBeam(wizard);
  const loser = balance > 0 ? duel.wizards[1] : balance < 0 ? duel.wizards[0] : null;
  duel.events.push({ type: "clashEnd", loser: loser ? loser.index : null, x: point.x, z: point.z });
  if (!loser) return; // a perfect draw: both beams just fizzle out

  const winner = duel.wizards[1 - loser.index];
  const strength = Math.min(1, Math.max(CLASH.minStrength, Math.abs(balance)));
  strike(duel, loser, {
    damage: CLASH.damage * strength,
    push: direction(winner, loser), // thrown away from the winner
    knockback: CLASH.knockback,
    stun: CLASH.stun,
    stopSteps: CLASH.stopSteps,
  });
}

// ---- Keeping things in place ----

function keepOnPlatform(wizard) {
  clampToPlatform(wizard, wizard.data.bodyRadius);
}

// Keeps a point (anything with x and z) far enough inside the platform for a body of this radius:
// past the limit, it's scaled back toward the centre (same direction, distance = limit).
function clampToPlatform(point, bodyRadius) {
  const limit = ARENA.radius - bodyRadius;
  const distance = Math.hypot(point.x, point.z); // distance from the platform's centre
  if (distance > limit) {
    point.x *= limit / distance;
    point.z *= limit / distance;
  }
}

// Stops the two wizards from gliding through each other: if their bodies overlap, push both apart.
function keepApart(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distance = Math.hypot(dx, dz);
  const minDistance = a.data.bodyRadius + b.data.bodyRadius;
  if (distance > 0 && distance < minDistance) {
    const push = (minDistance - distance) / 2 / distance; // each moves half the overlap
    a.x -= dx * push;
    a.z -= dz * push;
    b.x += dx * push;
    b.z += dz * push;
  }
}

// Lock-on: each wizard faces the other. A beam on its way or flowing keeps its caster facing its
// fixed aim (in a clash both face each other again), and a sweeping whip turns him with the lash.
function faceEachOther(duel) {
  const [a, b] = duel.wizards;
  for (const [me, other] of [[a, b], [b, a]]) {
    const aimFixed = ((me.beamTimer > 0 || me.beaming) && !duel.clash) || me.whip;
    if (!aimFixed) me.facing = angleOf(other.x - me.x, other.z - me.z);
  }
}
