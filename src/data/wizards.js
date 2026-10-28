// The two duellists as data. view/wizard.js builds a stand-in from either entry;
// game/duel.js reads start, speed, bodyRadius, maxHealth, bolt, beam and special.

// Which clip of a real model (blender/02_combine.py makes it from the Mixamo downloads) plays for each
// moment of the duel: the clip's name, which frames of it (Mixamo's frame numbers, 30 a second), how
// fast, and whether it loops or holds its last frame. rootMotion: true lets a clip carry the body away
// from his spot (the KO's fall); every other clip stays where the rules put him.
// Both wizards play these same clips, Dumbledore's: Voldemort borrows his skeleton (blender/01c), so
// they fit him too. To give Voldemort his own, download them on Dumbledore in Mixamo into
// models_source/mixamo/voldemort, run 02_combine.py -- voldemort, and give him his own table.
const MIXAMO_CLIPS = {
  idle: { name: "idle", loop: true },
  // The upswing only. It starts with the rules' 0.12 s wind-up, so its wand tip passes bolt height
  // (1.1 m) just as the bolt leaves: an earlier `from` throws the bolt from his knees.
  cast: { name: "cast", from: 22, to: 42, speed: 1.8 },
  // Wind back (frame 6), then the right arm thrusts forward (frame 15) during the beam's 0.25 s
  // wind-up, and holds there while it flows.
  beam: { name: "beam", from: 6, to: 15, speed: 1.2, hold: true },
  shield: { name: "block", from: 0, to: 12, speed: 1.5, hold: true }, // the guard, held
  hit: { name: "hit", from: 0, to: 24, speed: 1.6 },
  ko: { name: "ko", hold: true, rootMotion: true }, // he falls backwards, away from his spot
  special: { name: "whip", from: 16, to: 56, speed: 2.4 }, // the swing, fitted to the whip's 0.55 s
};

export const WIZARDS = {
  dumbledore: {
    name: "Dumbledore",
    fullName: "Albus Dumbledore", // on the start screen
    start: { x: -4, z: 0 }, // metres from the arena's centre: on the left
    speed: 3.5, // gliding speed, metres per second
    bodyRadius: 0.4, // how wide his body is, for the platform's edge, bumping and being hit
    maxHealth: 100,
    bolt: "stupefy", // his basic spell (data/spells.js)
    beam: "expelliarmus", // his beam
    special: "fireWhip", // his special move
    // His real model. Without the file, he keeps his stand-in.
    model: {
      file: "models/dumbledore.glb",
      clips: MIXAMO_CLIPS,
      wand: { bone: "mixamorig:RightHand" }, // his model has no wand: give him one in his right hand
    },
    glowingEyes: false,
    colors: {
      robe: "#6b3fa0", // purple
      skin: "#e8c4a0",
      eyes: "#3a6fb0", // blue
      wand: "#9a7448", // the Elder Wand: knotted grey-brown wood
      hat: "#5a3390", // null = no hat
      beard: "#dcdcdc", // null = no beard
      ui: "#a77de8", // his health bar
    },
  },

  voldemort: {
    name: "Voldemort",
    fullName: "Lord Voldemort",
    start: { x: 4, z: 0 }, // on the right
    speed: 3.5,
    bodyRadius: 0.4,
    maxHealth: 100,
    bolt: "confringo",
    beam: "avadaKedavra",
    special: "fiendfyre",
    // Mixamo couldn't rig his model (arms inside a wide cape), so blender/01c_borrow_rig.py gave him
    // Dumbledore's skeleton, and 02_combine.py -- voldemort dumbledore gave him Dumbledore's clips.
    // His special uses the whip's swing: he flings the Fiendfyre serpent out.
    model: {
      file: "models/voldemort.glb",
      clips: MIXAMO_CLIPS,
      // His model's own wand was removed so it could be rigged (blender/01b): he holds one of ours.
      wand: { bone: "mixamorig:RightHand" },
    },
    glowingEyes: true,
    colors: {
      robe: "#1c1c22", // almost black
      skin: "#e6e2d8", // very pale
      eyes: "#e0302a", // red
      wand: "#e8e0c8", // pale, like bone
      hat: null,
      beard: null,
      ui: "#e0302a",
    },
  },
};
