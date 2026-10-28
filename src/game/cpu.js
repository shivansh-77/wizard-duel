import { ARENA } from "../data/arena.js";
import { CPU } from "../data/cpu.js";
import { BEAMING, BOLTS, PROTEGO, SPECIALS } from "../data/spells.js";
import { STEP_SECONDS } from "./fixed_step.js";
import { forward } from "./geometry.js";
import { createRandom } from "./random.js";

// The CPU opponent. Every step it looks at the duel and returns the same kind of input object as
// the keyboard ({ x, z, cast, shield, apparate, beam, special }), so the rules can't tell a CPU
// from a player. Its "dice" are seeded (game/random.js): the same seed and the same duel give the
// same choices.

// The CPU's own memory between steps.
export function createCpu(seed) {
  return {
    random: createRandom(seed),
    circling: 1, // which way he circles you: 1 or -1
    circleTimer: 0, // time until he may switch direction
    handledBolt: null, // the incoming bolt he has already decided about
    handledBeam: false, // whether he has already decided about your current beam
    handledWhip: false, // ...about your current whip
    handledSerpent: null, // ...about this Fiendfyre serpent
    dodge: null, // { x, z, time }: gliding out of harm's way
    shieldWait: 0, // time to wait before raising Protego (to time a reflect)
    shieldHold: 0, // time to keep Protego up
    wantsToApparate: false,
    wantsBeam: false, // answer your beam with his own
  };
}

export function cpuInput(cpu, duel, index) {
  const input = { x: 0, z: 0, cast: false, shield: false, apparate: false, beam: false, special: false };
  const me = duel.wizards[index];
  const foe = duel.wizards[1 - index];
  if (duel.phase !== "fight" || me.down || me.transit > 0) return input;

  // Locked in a clash, all that counts is mashing: a press now and then, about
  // clashPressesPerSecond times a second.
  if (duel.clash) {
    input.cast = cpu.random() < CPU.clashPressesPerSecond * STEP_SECONDS;
    return input;
  }

  // Direction toward the foe, and his distance.
  const toFoe = { x: foe.x - me.x, z: foe.z - me.z };
  const distance = Math.hypot(toFoe.x, toFoe.z) || 1;
  toFoe.x /= distance;
  toFoe.z /= distance;

  // 1. Moving: circle around the foe (sideways = toFoe turned 90°), switching direction now and then,
  //    while keeping a comfortable distance. With a fire whip ready he closes in to whip range.
  const special = SPECIALS[me.data.special];
  const whipReady = special.kind === "whip" && me.specialCooldown === 0;
  const farDistance = whipReady ? special.reach * 0.7 : CPU.farDistance;
  const nearDistance = whipReady ? 0 : CPU.nearDistance;
  cpu.circleTimer -= STEP_SECONDS;
  if (cpu.circleTimer <= 0) {
    cpu.circling = cpu.random() < 0.5 ? -1 : 1;
    cpu.circleTimer = 0.6 + cpu.random() * 1.4;
  }
  let x = -toFoe.z * cpu.circling;
  let z = toFoe.x * cpu.circling;
  if (distance > farDistance) {
    x += toFoe.x;
    z += toFoe.z;
  } else if (distance < nearDistance) {
    x -= toFoe.x;
    z -= toFoe.z;
  }
  const fromCentre = Math.hypot(me.x, me.z);
  if (fromCentre > ARENA.radius - CPU.edgeMargin) {
    x -= (me.x / fromCentre) * 1.5;
    z -= (me.z / fromCentre) * 1.5;
  }

  // 2. Defending: decide once about each danger (after his reaction time), then carry the plan out.
  const threat = findThreat(duel, me);
  if (threat && threat.bolt !== cpu.handledBolt) {
    cpu.handledBolt = threat.bolt;
    planDefence(cpu, me, threat);
  }
  const foeBeam = foe.beamTimer > 0 || foe.beaming;
  const beamNoticed = foe.beaming || BEAMING.windUp - foe.beamTimer >= CPU.reactionTime;
  if (!foeBeam) {
    cpu.handledBeam = false;
  } else if (beamNoticed && !cpu.handledBeam) {
    cpu.handledBeam = true;
    planBeamDefence(cpu, me, foe);
  }
  const foeSpecial = SPECIALS[foe.data.special];
  const whipComing = foeSpecial.kind === "whip" && (foe.specialTimer > 0 || foe.whip);
  if (!whipComing) {
    cpu.handledWhip = false;
  } else if (!cpu.handledWhip && distance < foeSpecial.reach + 1) {
    cpu.handledWhip = true;
    planWhipDefence(cpu, me, toFoe);
  }
  for (const serpent of duel.serpents) {
    const close = Math.hypot(serpent.x - me.x, serpent.z - me.z) < CPU.serpentDodgeDistance;
    if (serpent.owner !== me.index && close && serpent !== cpu.handledSerpent) {
      cpu.handledSerpent = serpent;
      planSerpentDefence(cpu, me, serpent);
    }
  }

  if (cpu.dodge && cpu.dodge.time > 0) {
    cpu.dodge.time -= STEP_SECONDS;
    x = cpu.dodge.x;
    z = cpu.dodge.z;
  }
  if (cpu.shieldWait > 0) {
    cpu.shieldWait -= STEP_SECONDS;
  } else if (cpu.shieldHold > 0) {
    cpu.shieldHold -= STEP_SECONDS;
    input.shield = true;
  }
  if (cpu.wantsToApparate) {
    cpu.wantsToApparate = false;
    input.apparate = true;
  }
  if (cpu.wantsBeam) {
    cpu.wantsBeam = false;
    input.beam = true;
  }

  // 3. Attacking: when his moves are ready, now and then: his special (the whip only when you're
  //    within reach), a beam, or a bolt. Never into a raised shield.
  const free = !me.shieldUp && !input.shield && !input.beam && foe.transit === 0 && !foe.shieldUp;
  const inReach = special.kind !== "whip" || distance < special.reach * 0.85;
  if (free && me.specialCooldown === 0 && inReach && cpu.random() < CPU.specialsPerSecond * STEP_SECONDS) {
    input.special = true;
  } else if (free && me.beamCooldown === 0 && cpu.random() < CPU.beamsPerSecond * STEP_SECONDS) {
    input.beam = true;
  } else if (free && me.castCooldown === 0 && cpu.random() < CPU.castsPerSecond * STEP_SECONDS) {
    input.cast = true;
  }

  const length = Math.hypot(x, z);
  input.x = length > 0 ? x / length : 0;
  input.z = length > 0 ? z / length : 0;
  return input;
}

// The incoming bolt that will hit soonest, if any: one that has flown at least reactionTime and
// would touch him within lookAhead seconds if he stood still.
function findThreat(duel, me) {
  let threat = null;
  for (const bolt of duel.bolts) {
    if (bolt.owner === me.index || bolt.age < CPU.reactionTime) continue;
    // Closest approach: the time t when the bolt is nearest to him, and how near it gets then.
    const px = me.x - bolt.x;
    const pz = me.z - bolt.z;
    const speedSquared = bolt.vx * bolt.vx + bolt.vz * bolt.vz;
    const t = (px * bolt.vx + pz * bolt.vz) / speedSquared;
    const miss = Math.hypot(px - bolt.vx * t, pz - bolt.vz * t);
    const willHit = t > 0 && t < CPU.lookAhead && miss < me.data.bodyRadius + BOLTS[bolt.spell].radius + 0.1;
    if (willHit && (!threat || t < threat.time)) threat = { bolt, time: t };
  }
  return threat;
}

// Rolls the dice once for a bolt: dodge sideways, raise Protego (sometimes timed to reflect), or
// apparate sideways.
function planDefence(cpu, me, threat) {
  const { bolt } = threat;
  const speed = Math.hypot(bolt.vx, bolt.vz);
  const side = sideways(me, bolt, { x: bolt.vx / speed, z: bolt.vz / speed });

  const roll = cpu.random();
  const shield = roll >= CPU.dodgeChance && roll < CPU.dodgeChance + CPU.shieldChance;
  const apparate = roll >= CPU.dodgeChance + CPU.shieldChance && me.apparateCooldown === 0;
  if (shield) {
    const perfect = cpu.random() < CPU.perfectShieldChance;
    // To reflect, the shield must go up less than reflectWindow before the bolt lands.
    cpu.shieldWait = perfect ? Math.max(0, threat.time - PROTEGO.reflectWindow * 0.6) : 0;
    cpu.shieldHold = threat.time - cpu.shieldWait + 0.2;
  } else {
    // Dodge or apparate: both go sideways (apparating uses his gliding direction).
    cpu.dodge = { ...side, time: apparate ? STEP_SECONDS : threat.time + 0.1 };
    cpu.wantsToApparate = apparate;
  }
}

// Rolls the dice once for each beam the foe starts: answer with his own beam if it's ready (that
// makes a clash), otherwise hold Protego against it, or glide sideways out of its line.
function planBeamDefence(cpu, me, foe) {
  const roll = cpu.random();
  if (me.beamCooldown === 0 && roll < CPU.beamAnswerChance) {
    cpu.wantsBeam = true;
  } else if (me.shieldCooldown === 0 && cpu.random() < 0.5) {
    cpu.shieldWait = 0;
    cpu.shieldHold = PROTEGO.maxHold;
  } else {
    cpu.dodge = { ...sideways(me, foe, foe.beamDir), time: BEAMING.windUp + 0.5 };
  }
}

// The fire whip winding up within reach: back straight off, raise Protego, or apparate away.
function planWhipDefence(cpu, me, toFoe) {
  const away = { x: -toFoe.x, z: -toFoe.z };
  const roll = cpu.random();
  if (roll < 0.45) {
    cpu.dodge = { ...away, time: 0.6 };
  } else if (roll < 0.8 && me.shieldCooldown === 0) {
    cpu.shieldWait = 0;
    cpu.shieldHold = 0.7;
  } else {
    cpu.dodge = { ...away, time: STEP_SECONDS };
    cpu.wantsToApparate = me.apparateCooldown === 0;
  }
}

// A serpent close by: a sharp sidestep (faster than it can turn), Protego, or apparate.
function planSerpentDefence(cpu, me, serpent) {
  const side = sideways(me, serpent, forward(serpent.heading));
  const roll = cpu.random();
  if (roll < 0.5) {
    cpu.dodge = { ...side, time: 0.6 };
  } else if (roll < 0.8 && me.shieldCooldown === 0) {
    cpu.shieldWait = 0;
    cpu.shieldHold = 0.6;
  } else {
    cpu.dodge = { ...side, time: STEP_SECONDS };
    cpu.wantsToApparate = me.apparateCooldown === 0;
  }
}

// "Sideways" from something coming along `dir` (length 1) from `from`: dir turned 90°, toward
// whichever side of its path he's already on.
function sideways(me, from, dir) {
  let x = -dir.z;
  let z = dir.x;
  if ((me.x - from.x) * x + (me.z - from.z) * z < 0) {
    x = -x;
    z = -z;
  }
  return { x, z };
}
