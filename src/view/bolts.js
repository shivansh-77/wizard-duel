import { Color3, MeshBuilder, StandardMaterial, TrailMesh, Vector3 } from "@babylonjs/core";
import { BOLTS } from "../data/spells.js";

// Bolts fly at wand height. The rules only know x and z (seen from above); the height is looks.
export const BOLT_HEIGHT = 1.1;
// The rules launch a bolt from a fixed point in front of the wizard, but his animated wand is
// somewhere near it. Over its first LAUNCH_DISTANCE metres a bolt glides from the real wand tip onto
// the rules' path, so it leaves the wand and still hits where the rules say.
export const LAUNCH_DISTANCE = 1.5; // (Fiendfyre's serpent launches the same way: view/specials.js)

// Draws the bolts in duel.bolts: a glowing ball with a trail behind it for each. sync() runs every
// frame: it makes meshes for new bolts, moves them, and removes the meshes of bolts that are gone.
// wandTip(i) says where wizard i's wand tip is drawn now (view/wizard.js wandTipPosition).
// Each bolt also leaves a tail of sparks (effects.trail).
export function createBoltViews(scene, wandTip, effects) {
  const materials = new Map(); // spell name -> its material (all its bolts and trails share it)
  const views = new Map(); // a bolt (the rules' object) -> { ball, trail, sparkles, start, offset, fade }

  function materialFor(spell) {
    if (!materials.has(spell)) {
      const material = new StandardMaterial(`${spell}Mat`, scene);
      material.emissiveColor = Color3.FromHexString(BOLTS[spell].color);
      material.disableLighting = true; // a bolt is light: the scene's lights and shadows don't touch it
      materials.set(spell, material);
    }
    return materials.get(spell);
  }

  function createBolt(bolt) {
    const ball = MeshBuilder.CreateSphere("bolt", { diameter: BOLTS[bolt.spell].radius * 2, segments: 12 }, scene);
    ball.material = materialFor(bolt.spell);
    // How far the real wand tip is from where the rules launched the bolt: that gap closes as it flies.
    const origin = wandTip(bolt.owner);
    const offset = origin.subtract(new Vector3(bolt.x, BOLT_HEIGHT, bolt.z));
    // Place it before the trail starts, or the trail would begin at the scene's origin. TrailMesh starts
    // from the ball's bounding box centre in the world, which Babylon only works out with the world
    // matrix (normally while drawing): so compute that now.
    ball.position.copyFrom(origin);
    ball.computeWorldMatrix(true);
    // TrailMesh: a ribbon that follows a node, remembering where it was over the last few frames.
    const trail = new TrailMesh("boltTrail", ball, scene, { diameter: 0.1, length: 8, autoStart: true });
    trail.material = ball.material;
    const sparkles = effects.trail(ball, BOLTS[bolt.spell].color);
    return { ball, trail, sparkles, start: { x: bolt.x, z: bolt.z }, offset, fade: 1 };
  }

  return {
    sync(bolts) {
      for (const bolt of bolts) {
        if (!views.has(bolt)) views.set(bolt, createBolt(bolt));
        const view = views.get(bolt);
        // fade: 1 at the wand, 0 after LAUNCH_DISTANCE. It only ever goes down, so a bolt reflected
        // back past its start doesn't drift toward the old wand again.
        const travelled = Math.hypot(bolt.x - view.start.x, bolt.z - view.start.z);
        view.fade = Math.min(view.fade, Math.max(0, 1 - travelled / LAUNCH_DISTANCE));
        view.ball.position.set(bolt.x, BOLT_HEIGHT, bolt.z).addInPlace(view.offset.scale(view.fade));
      }
      const alive = new Set(bolts);
      for (const [bolt, view] of views) {
        if (alive.has(bolt)) continue;
        // The sparkles outlive the ball: give them a fixed spot, then let the last ones fade out.
        view.sparkles.emitter = view.ball.position.clone();
        view.sparkles.stop();
        view.trail.dispose();
        view.ball.dispose();
        views.delete(bolt);
      }
    },
  };
}
