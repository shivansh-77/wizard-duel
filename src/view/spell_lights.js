import { Color3, Light, PointLight, Vector3 } from "@babylonjs/core";
import { BEAMS, BOLTS, CASTING, CLASH, SPECIALS } from "../data/spells.js";
import { BOLT_HEIGHT } from "./bolts.js";

const POOL = 4; // point lights shared by all the spells
const SCENE_LIGHTS = 2; // the sky and the sun (view/lighting.js)

// Spells light up what's around them: the floor under a bolt, the wizard a beam hits, the hall during
// a clash. A PointLight shines in every direction from one point, fading out to nothing at `range`.
// Lights are costly (every lit pixel adds up every light), so there's a small pool of POOL lights,
// handed out each frame to the brightest magic: the clash first, then beams, serpents, the whip, bolts.
export function createSpellLights(scene) {
  // A material only adds up so many lights (maxSimultaneousLights, 4 by default): raise it, on every
  // material there is and every one made later (the models' arrive when their .glb has loaded).
  const allow = (material) => {
    material.maxSimultaneousLights = SCENE_LIGHTS + POOL;
  };
  scene.materials.forEach(allow);
  scene.onNewMaterialAddedObservable.add(allow);

  const lights = Array.from({ length: POOL }, (_, i) => {
    const light = new PointLight(`spellLight${i}`, new Vector3(0, -10, 0), scene);
    light.specular = Color3.Black(); // no shiny spots: just coloured light
    // The fade to `range` (FALLOFF_STANDARD) also for the models' PBR materials, which would
    // otherwise use real-world falloff (1 / distance²) and look far dimmer.
    light.falloffType = Light.FALLOFF_STANDARD;
    light.intensity = 0; // a spare light stays on, but dark: switching lights on and off
    return light; // would make Babylon rebuild the materials' shaders
  });

  return {
    sync(duel) {
      const time = performance.now() / 1000;
      const wanted = []; // { x, y, z, hex, intensity, range }, most important first
      if (duel.clash && duel.clash.point) {
        const { x, z } = duel.clash.point;
        wanted.push({ x, y: BOLT_HEIGHT, z, hex: CLASH.color, intensity: 2.5, range: 9 });
      }
      for (const wizard of duel.wizards) {
        if (wizard.beamStart === null || !wizard.beamEnd) continue;
        const x = (wizard.beamStart.x + wizard.beamEnd.x) / 2; // the middle of the beam
        const z = (wizard.beamStart.z + wizard.beamEnd.z) / 2;
        const length = Math.hypot(wizard.beamEnd.x - wizard.beamStart.x, wizard.beamEnd.z - wizard.beamStart.z);
        wanted.push({ x, y: BOLT_HEIGHT, z, hex: BEAMS[wizard.data.beam].color, intensity: 1.6, range: length / 2 + 3 });
      }
      for (const serpent of duel.serpents) {
        // It grows as it closes in (serpent.radius, the rules' bite), and so does its light.
        const special = SPECIALS[duel.wizards[serpent.owner].data.special];
        const grown = serpent.radius / special.endRadius; // startRadius ÷ endRadius newborn, 1 full-grown
        wanted.push({ x: serpent.x, y: 0.6 + 0.6 * grown, z: serpent.z, hex: special.color, intensity: 1.2 + 1.4 * grown, range: 4 + 5 * grown });
      }
      for (const wizard of duel.wizards) {
        if (!wizard.whip) continue;
        const special = SPECIALS[wizard.data.special];
        const reach = (CASTING.wandReach + special.reach) / 2; // halfway along the lash
        const x = wizard.x + Math.sin(wizard.whip.angle) * reach;
        const z = wizard.z + Math.cos(wizard.whip.angle) * reach;
        wanted.push({ x, y: 0.9, z, hex: special.color, intensity: 1.8, range: 6 });
      }
      for (const bolt of duel.bolts) {
        wanted.push({ x: bolt.x, y: BOLT_HEIGHT, z: bolt.z, hex: BOLTS[bolt.spell].color, intensity: 1.2, range: 4 });
      }

      lights.forEach((light, i) => {
        const glow = wanted[i];
        if (!glow) {
          light.intensity = 0;
          return;
        }
        light.position.set(glow.x, glow.y, glow.z);
        light.diffuse = Color3.FromHexString(glow.hex);
        light.range = glow.range;
        light.intensity = glow.intensity * (0.9 + 0.1 * Math.sin(time * 37 + i * 2)); // magic flickers
      });
    },
  };
}
