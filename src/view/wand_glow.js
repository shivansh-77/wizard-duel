import { Color3, MeshBuilder, StandardMaterial } from "@babylonjs/core";
import { BEAMING, BEAMS, BOLTS, CASTING, SPECIALS } from "../data/spells.js";
import { setSparkColor } from "./effects.js";

const SIZE = 0.08; // metres across, at rest
const FLASH_TIME = 0.15; // seconds a cast's flash lasts

// A little light at each wand's tip (a glowing sphere: the GlowLayer gives it a halo). It shows what
// the wizard is doing: a faint spark at rest; it swells in the spell's colour while a spell winds up;
// flashes when a bolt leaves; burns bright while a beam flows. While a beam or a special charges,
// sparks are drawn in toward it (effects.gather). Like every view, it only reads the rules' state.
export function createWandGlows(scene, wizards, effects, wandTip) {
  const glows = wizards.map((data) => {
    const sphere = MeshBuilder.CreateSphere(`${data.name}WandGlow`, { diameter: SIZE, segments: 8 }, scene);
    const material = new StandardMaterial(`${data.name}WandGlowMat`, scene);
    material.disableLighting = true; // made of light: only its emissive colour shows
    sphere.material = material;
    const gather = effects.gather(sphere, BEAMS[data.beam].color);
    return { sphere, material, gather, gathering: false, flash: 0 };
  });

  return {
    // Called when the rules report a cast (view/reactions.js): the bolt has just left the wand.
    flash(index) {
      glows[index].flash = FLASH_TIME;
    },

    // Every frame, after the animations have moved the hands (main.js).
    sync(duel, seconds) {
      const time = performance.now() / 1000;
      duel.wizards.forEach((state, i) => {
        const glow = glows[i];
        const { data } = state;
        glow.flash = Math.max(0, glow.flash - seconds);
        glow.sphere.isVisible = !state.down && state.transit === 0;
        glow.sphere.position.copyFrom(wandTip(i));

        // What the wand is doing: the colour, the size (1 = SIZE) and the brightness.
        let hex = BOLTS[data.bolt].color;
        let size = 0.7;
        let brightness = 0.5;
        if (state.beaming) {
          hex = BEAMS[data.beam].color;
          size = 2.4 + 0.4 * Math.sin(time * 30);
          brightness = 1.5;
        } else if (state.beamTimer > 0) {
          hex = BEAMS[data.beam].color;
          size = 1 + 2.5 * (1 - state.beamTimer / BEAMING.windUp);
          brightness = 1.2;
        } else if (state.specialTimer > 0) {
          hex = SPECIALS[data.special].color;
          size = 1 + 2.5 * (1 - state.specialTimer / SPECIALS[data.special].windUp);
          brightness = 1.2;
        } else if (state.castTimer > 0) {
          size = 1 + 1.5 * (1 - state.castTimer / CASTING.windUp);
          brightness = 1.1;
        }
        size += (glow.flash / FLASH_TIME) * 3; // the flash: a quick pop that shrinks away
        brightness += (glow.flash / FLASH_TIME) * 1.5;
        glow.sphere.scaling.setAll(size);
        glow.material.emissiveColor = Color3.FromHexString(hex).scale(brightness);

        // Gathering sparks while a beam or a special charges, in its colour.
        const charging = state.beamTimer > 0 || state.specialTimer > 0;
        if (charging && !glow.gathering) {
          setSparkColor(glow.gather, hex);
          glow.gather.start();
        } else if (!charging && glow.gathering) {
          glow.gather.stop();
        }
        glow.gathering = charging;
      });
    },
  };
}
