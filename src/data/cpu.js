// How the CPU opponent plays (game/cpu.js). Times in seconds, distances in metres. Change these
// numbers to make him easier or harder.
export const CPU = {
  nearDistance: 4.5, // he backs off when you're closer than this...
  farDistance: 7, // ...and comes closer when you're farther than this; in between he circles you
  edgeMargin: 1.5, // he steers back toward the centre when he's this close to the edge

  reactionTime: 0.2, // a bolt must have flown this long before he notices it
  lookAhead: 0.6, // he reacts to bolts that would hit him within this time
  dodgeChance: 0.5, // when a bolt comes: dodge sideways...
  shieldChance: 0.3, // ...or raise Protego... (otherwise he apparates, if he can)
  perfectShieldChance: 0.35, // ...and some shields are timed to reflect the bolt

  castsPerSecond: 0.9, // how eagerly he attacks once his spell is ready

  beamsPerSecond: 0.12, // how often he starts a beam of his own once it's ready
  beamAnswerChance: 0.55, // when you start a beam: answer with his (a clash!), else shield or dodge
  clashPressesPerSecond: 6.5, // how fast he mashes in a clash: mash faster than this to win

  specialsPerSecond: 0.15, // how often he uses his special once it's ready (the whip only in reach)
  serpentDodgeDistance: 2.8, // he sidesteps a Fiendfyre serpent once it's this close
};
