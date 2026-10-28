// The arena's numbers (metres) and colours. view/arena.js builds the meshes from these;
// gameplay will read `radius` to keep the wizards on the platform (step 4).
export const ARENA = {
  radius: 8, // the round platform the wizards fight on; its top surface is at y = 0
  height: 0.6, // how far the platform stands above the floor of the hall

  pillars: {
    count: 10,
    ringRadius: 10.5, // just outside the platform's edge
    // A full ring (0° = right, 90° = far side, 180° = left): the duel camera turns all the way
    // round, and fades any pillar that stands in its way (view/camera.js). The last one stops a
    // step short of 360°, which would be the first one again.
    fromAngle: 0,
    toAngle: 324,
    height: 6,
    diameter: 0.9,
  },

  // Metres from the camera: no fog closer than `start`, everything past `end` is fully fogged.
  fog: { start: 28, end: 60 },

  // The platform's stone top (drawn in code by view/arena_art.js): rings of slabs, a magic circle in
  // the middle, glowing runes near the edge. Radii in metres from the centre.
  slabRings: [1.4, 2.9, 4.4, 5.9, 7.1], // the joints between rings of slabs
  slabLength: 1.7, // roughly how long a slab is along its ring
  circleRadius: 1.4, // the magic circle in the middle
  runeRadius: 7.5, // the ring of runes, just inside the gold rim
  reflection: 0.22, // how much the polished stone mirrors (0 = none, 1 = a perfect mirror)

  colors: {
    background: "#0d0d1f", // also the fog's colour, so far things fade into the background
    platform: "#8a8578", // the platform's sides
    stone: "#7d776b", // the top's slabs
    joints: "#3a352e", // the lines between slabs and the engraved circle
    runes: "#8cc8ff", // glowing pale blue
    rim: "#c9a227",
    floor: "#211a14",
    pillar: "#6b6f78",
    brazier: "#a8861f", // the bowls on the pillars: dark gold
    flame: "#3dff8a", // Floo-powder green fire
  },
};
