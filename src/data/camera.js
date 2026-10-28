// The duel camera's numbers (view/camera.js). Angles in degrees, distances in metres.
export const CAMERA = {
  fov: 50, // how wide the camera sees, top to bottom (Babylon's default is about 46°)
  targetHeight: 1.0, // it looks at the point halfway between the wizards, this high (their chests)
  pitch: 17, // how far it looks down: 0 = level, 90 = straight down
  margin: 2.2, // room kept on screen beyond each wizard, for his spells and his robe
  minDistance: 5.5, // never closer than this...
  maxDistance: 15, // ...nor farther
  // How quickly it follows (a share of the way per second, like the glide): higher = snappier.
  follow: { turn: 2.5, move: 4, zoom: 2 },

  // The other view (V switches): behind Dumbledore, over his right shoulder, looking toward Voldemort.
  behind: {
    back: 3.2, // how far behind him
    height: 2.4, // how high the camera is
    shoulder: 0.7, // how far to his right: he stands a little left of the middle, out of the way
    lookAhead: 3, // it looks at a point this far in front of him (less when Voldemort is closer)...
    lookHeight: 1.2, // ...this high
  },

  // Priori Incantatem: low and close, turned a little aside so the beams run into the distance,
  // still framing both wizards (not the golden bead: it slides toward the loser).
  clash: {
    pitch: 6,
    margin: 1.2, // tighter than the normal view's
    turn: 25, // degrees turned away from straight side-on
    blendSpeed: 2.5, // how fast it swings into the clash view and back (per second)
  },

  // Pillars that stand between the camera and the wizards fade to this see-through level.
  blocker: { width: 1.3, visibility: 0.15, fadeSpeed: 6 },

  shakeFade: 1.5, // how fast a shake dies down (metres of shake per second)
};
