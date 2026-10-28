import { MeshBuilder, Vector3 } from "@babylonjs/core";
import { CASTING, SPECIALS } from "../data/spells.js";
import { createGlowMaterial } from "./materials.js";

const POINTS = 16; // points along the lash's curve

// Dumbledore's fire whip: a glowing golden lash from his wand, reshaped every frame while it sweeps,
// with sparks flying off its tip. (Step 19 tried a lash made of the fire shader with a white-hot core
// and rising flames; this plain glowing one, from step 12, looked better.)
// The curve trails behind the swing like a real lash, droops toward its tip and ripples. The rules'
// lash starts at a fixed point in front of him; the drawn one is bent so its hand end sits on his real
// wand tip, while its far end stays where the rules hit.
export function createFireWhip(scene, data, { effects }) {
  const special = SPECIALS[data.special];
  const path = Array.from({ length: POINTS }, (_, i) => new Vector3(i * 0.1, -10, 0)); // hidden until used
  // Thick at the hand, thin at the tip: radiusFunction gives the radius at each point of the path.
  const radiusFunction = (i) => 0.09 - (0.06 * i) / (POINTS - 1);
  // updatable: true lets us reshape this same tube later (instance: tube), instead of making a new mesh.
  const tube = MeshBuilder.CreateTube(`${data.name}Whip`, { path, radiusFunction, tessellation: 10, updatable: true }, scene);
  // Made of light: only its emissive colour shows, and the GlowLayer gives it a halo.
  tube.material = createGlowMaterial(`${data.name}WhipMat`, special.color, scene);
  tube.isVisible = false;
  const sparks = effects.fountain(special.color, 180); // flying off the tip
  let sparking = false;

  return {
    sync(wizard, time, wandTip) {
      const whip = wizard.whip;
      tube.isVisible = Boolean(whip);
      if (!whip) {
        if (sparking) sparks.stop();
        sparking = false;
        return;
      }
      for (let i = 0; i < POINTS; i++) {
        const s = i / (POINTS - 1); // 0 at the hand, 1 at the tip
        const angle = whip.angle + 0.45 * s * s + 0.12 * s * Math.sin(time * 30 - s * 9); // trails behind, ripples
        const distance = CASTING.wandReach + s * (special.reach - CASTING.wandReach);
        path[i].set(wizard.x + Math.sin(angle) * distance, 1.1 - 0.55 * s, wizard.z + Math.cos(angle) * distance);
      }
      // Bend it onto the wand: the hand end moves all the way there, the far end not at all.
      const offset = wandTip.subtract(path[0]);
      path.forEach((point, i) => point.addInPlace(offset.scale(1 - i / (POINTS - 1))));
      MeshBuilder.CreateTube(tube.name, { path, radiusFunction, instance: tube }); // reshape it along the new curve
      sparks.emitter.copyFrom(path[POINTS - 1]);
      if (!sparking) sparks.start();
      sparking = true;
    },
  };
}
