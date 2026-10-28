// Spells and the rules of casting, as data. Times are in seconds, distances in metres, speeds in
// metres per second. game/duel.js runs them; the view files draw them.

// The basic bolt each wizard fires (data/wizards.js says whose is whose).
export const BOLTS = {
  stupefy: {
    name: "Stupefy",
    color: "#ff3b3b", // a red jet of light
    speed: 13,
    radius: 0.15, // for hitting, a bolt is a small circle
    damage: 10,
    knockback: 6, // how hard a hit shoves the target (m/s)
    lifetime: 1.6, // then it fizzles out
  },
  confringo: {
    name: "Confringo",
    color: "#ffa024", // a fiery orange blast
    speed: 13,
    radius: 0.15,
    damage: 10,
    knockback: 6,
    lifetime: 1.6,
  },
};

// Casting a bolt: a short wind-up (the arm rises), then the bolt leaves the wand.
export const CASTING = {
  windUp: 0.12,
  cooldown: 0.55, // from the press until he can cast again
  wandReach: 0.85, // the stand-in's wand tip is this far in front of his centre...
  wandSide: 0.2, // ...and this far to his right (see view/wizard.js)
};

// Protego: press to raise a shield, hold to keep it. Raised just before a bolt lands, it sends the
// bolt back at its caster.
export const PROTEGO = {
  maxHold: 1.2, // it drops by itself after this long
  cooldown: 0.8, // after it drops
  reflectWindow: 0.18, // a bolt landing this soon after raising it is reflected
  moveFactor: 0.5, // gliding speed while shielding
  radius: 0.85, // the bubble's size: a beam stops at its surface
  color: "#8fd3ff",
};

// The beam each wizard can channel (data/wizards.js says whose is whose).
export const BEAMS = {
  expelliarmus: {
    name: "Expelliarmus",
    color: "#ff4a4a", // red
    width: 0.14,
    length: 18, // long enough to cross the whole arena
    damagePerSecond: 25, // while it touches you
  },
  avadaKedavra: {
    name: "Avada Kedavra",
    color: "#3dff6e", // green
    width: 0.14,
    length: 18,
    damagePerSecond: 25,
  },
};

// Channelling a beam: a wind-up (he aims when it starts, and can't change it), then it flows.
// He's rooted the whole time and it doesn't follow you, so a beam is strong but risky.
export const BEAMING = {
  windUp: 0.25,
  duration: 1.2,
  cooldown: 4, // from the press
  // A beam swallows the other wizard's bolts that come within this distance of it. Both wands sit
  // 0.2 m to their owner's right, so a bolt fired straight back flies 0.4 m beside the beam: this
  // catches it. To break a beam with a bolt, glide well off its line first, then shoot at an angle.
  swallowRadius: 0.45,
};

// Priori Incantatem: when a wizard starts his beam while the other's is flowing, the two beams
// lock wand to wand. Pressing cast (or beam) pushes the meeting point toward the other wizard.
export const CLASH = {
  pushPerPress: 0.1, // each press moves the meeting point this far (the whole way, wand to wand, is 2)
  maxTime: 8, // then whoever has the meeting point on his side loses
  damage: 30, // for the loser
  minStrength: 0.4, // a win on time still does 40% of the damage (more, the further the point got)
  knockback: 9,
  stun: 0.6,
  stopSteps: 12, // a long hit-stop for the explosion
  color: "#ffd75e", // the golden meeting point
};

// One special each (data/wizards.js says whose is whose). `kind` picks the engine in
// game/specials.js that runs it, like Alien Fight's special-move engines.
export const SPECIALS = {
  fireWhip: {
    kind: "whip",
    name: "Fire whip",
    color: "#ffb347", // golden flame
    windUp: 0.2,
    sweepTime: 0.35, // the lash swings across in this long
    reach: 5, // metres from his centre
    arc: 120, // degrees: from 60° on his right to 60° on his left
    damage: 18,
    knockback: 10,
    stun: 0.5,
    stopSteps: 8,
    cooldown: 6, // from the press
  },
  fiendfyre: {
    kind: "serpent",
    name: "Fiendfyre",
    // How it's drawn: "beast" (a huge roaring head of fire trailing flames, view/fiendfyre_beast.js),
    // "sculpted" (a whole creature modelled with Node Geometry: head, body and tail,
    // view/fiendfyre_sculpted.js) or "caterpillar" (the step-16 fire tube with a small head,
    // view/fiendfyre_caterpillar.js). In the game, F cycles through them.
    look: "beast",
    color: "#ff5a1f", // cursed fire
    windUp: 0.3,
    // It swings round to you on a big arc, then lunges (game/specials.js). Tuned with a test sweep:
    // standing still or gliding in a straight line gets you bitten. Sidestepping while it swings is
    // wasted (it re-aims); the sidestep that works starts just as it lines up and lunges (about
    // 3.3–4.7 m out from a long cast: a window of about a quarter of a second); from 3 m or closer
    // it's too late. Circling him shakes it off from 6 m, not from the start positions.
    speed: 6, // slower than a bolt, but it hunts you
    arc: 90, // degrees: it leaves the wand this far to the side and swings round to you (a semicircle)
    lunge: 3.5, // metres: it lines up on you this far out and lunges straight...
    turnRate: 25, // ...turning at most this many degrees a second (the swing before isn't limited)
    startRadius: 0.4, // its head, for hitting: it leaves the wand this size...
    endRadius: 0.8, // ...and grows to this...
    growTime: 1.2, // ...over this many seconds (full-grown before it reaches you from the start positions)
    lifetime: 3, // 18 m of flight
    toughness: 2, // bolts it takes to put it out
    damage: 20,
    knockback: 8,
    stun: 0.4,
    stopSteps: 8,
    cooldown: 6,
    fire: {
      // How its fire looks (view/fire_material.js). The colour ramp from cold to hot: the colours
      // at heat 0, 0.25, 0.5, 0.75 and 1. Black is invisible (the fire's light is added to the scene).
      colors: ["#000000", "#5c0700", "#d92c08", "#ff8424", "#ffe2a2"], // deep and red: cursed fire
      brightness: 1, // above 1 is brighter than white: the tone mapping (view/post.js) brings it back
      glow: 0.35, // how strongly the GlowLayer halos it
      noiseSize: 0.42, // metres: the size of the biggest flame shapes
      rise: 1.8, // metres per second the flames climb
      wobble: 0.16, // metres: how far the surface boils outward (and up)
    },
  },
};

// Apparate: vanish and reappear a few metres away.
export const APPARATE = {
  distance: 3.2,
  transit: 0.18, // time spent "in between": invisible, and bolts pass through
  cooldown: 1.6,
};

// What a hit does besides damage.
export const HIT = {
  stopSteps: 5, // hit-stop: the whole duel freezes for 5 steps (about 0.08 s)
  stun: 0.25, // the target can't act for this long while he's knocked back
};
