import { MeshBuilder } from "@babylonjs/core";
import { SPECIALS } from "../data/spells.js";
import { createBeast, createBeastLooks } from "./fiendfyre_beast.js";
import { createCaterpillar } from "./fiendfyre_caterpillar.js";
import { createFireMaterial } from "./fire_material.js";
import { createFireWhip } from "./fire_whip.js";
import { createGlowMaterial } from "./materials.js";

const HEAD_WOBBLE = 0.03; // metres a serpent head's surface boils out (less than its eyes stick out)
const HEAD_HEAT = 0.25; // a serpent's head burns this much hotter than its body (heat runs 0 to 1)
const LOOKS = ["beast", "sculpted", "caterpillar"]; // Fiendfyre's looks, in the order F cycles them

// Draws the specials: Dumbledore's fire whip while it sweeps (view/fire_whip.js), and every Fiendfyre
// serpent in duel.serpents, in the look its data asks for (`look`, which F cycles). Like the other
// views, it only reads the rules' state. wandTip(i) says where wizard i's wand tip is drawn now
// (view/wizard.js wandTipPosition): the whip grows from it, and a serpent leaps out of it. Both are
// made of fire: the NodeMaterial in view/fire_material.js.
export function createSpecialViews(scene, wizards, effects, wandTip) {
  // One fire material per special (its colours and flames are in data/spells.js `fire`), shared by
  // every mesh made of that fire. A serpent's head gets its own, calmer copy: a surface that boils
  // out further than its eyes stick out would swallow them.
  const fires = {};
  const headFires = {};
  for (const data of wizards) {
    const special = SPECIALS[data.special];
    if (special.fire) fires[data.special] ??= createFireMaterial(scene, `${special.name} fire`, special.fire);
    if (special.kind === "serpent" && !headFires[data.special]) {
      const head = createFireMaterial(scene, `${special.name} head`, { ...special.fire, wobble: HEAD_WOBBLE });
      // Hotter than the body, so the head never cools into a dark patch that vanishes: a smaller
      // cut leaves more heat. Any input block of a NodeMaterial can be changed like this, even
      // while the game runs.
      head.getBlockByName("cut").value -= HEAD_HEAT;
      headFires[data.special] = head;
    }
  }
  // A shader is compiled the first time a mesh needs it, and until it's ready the mesh isn't drawn:
  // the first whip of a duel would flash by invisible. So compile each fire now, while the game loads,
  // for a small hidden sphere (a sphere and a tube need the same shader: both have positions + normals).
  const sample = MeshBuilder.CreateSphere("fireWarmUp", { diameter: 0.1 }, scene);
  sample.isVisible = false;
  const materials = [...Object.values(fires), ...Object.values(headFires)];
  const compiling = materials.flatMap((fire) => [
    fire.forceCompilationAsync(sample),
    fire.forceCompilationAsync(sample, { useInstances: true }), // the version for instances (the sculpted body)
  ]);
  Promise.all(compiling).finally(() => sample.dispose());
  // The GlowLayer (view/lighting.js) normally halos only a StandardMaterial's emissive colour.
  // referenceMeshToUseItsOwnMaterial draws a mesh into it with its own material instead: for the
  // fire, that's the glow colour its FragmentOutputBlock gets.
  const glowLayer = scene.getGlowLayerByName("glow");
  const glow = (mesh) => glowLayer.referenceMeshToUseItsOwnMaterial(mesh);
  const eyes = createGlowMaterial("serpentEyeMat", "#fff1a0", scene); // the caterpillar's eyes
  const beast = createBeastLooks(scene); // the beast's fangs, throat, eyes and flame picture

  // Fiendfyre's look: data/spells.js picks the first one, F cycles through them (new casts only).
  // The sculpted one is built with Node Geometry, which takes a moment, so its file is loaded with a
  // dynamic import() the first time it's wanted: until it's ready, Fiendfyre is drawn as the beast.
  const serpentName = wizards.map((data) => data.special).find((name) => SPECIALS[name].kind === "serpent");
  let look = serpentName ? SPECIALS[serpentName].look : "beast";
  let sculpted = null; // { module, looks } once loaded and built
  let sculptedState = "not loaded";
  function prepare(name) {
    if (name !== "sculpted" || sculptedState !== "not loaded") return;
    sculptedState = "loading";
    import("./fiendfyre_sculpted.js")
      .then((module) => {
        sculpted = { module, looks: module.createSculptedLooks(scene, fires[serpentName], glow, beast) };
        sculptedState = "ready";
      })
      .catch((error) => {
        sculptedState = "failed";
        console.warn("The sculpted Fiendfyre isn't available:", error);
      });
  }
  prepare(look);
  const creator = () => {
    if (look === "caterpillar") return createCaterpillar;
    if (look === "sculpted" && sculpted) return sculpted.module.createSculpted;
    return createBeast;
  };

  const whips = wizards.map((data) =>
    SPECIALS[data.special].kind === "whip" ? createFireWhip(scene, data, { effects }) : null,
  );
  const serpents = new Map(); // a serpent (the rules' object) -> its view

  return {
    // For the HUD: which look new Fiendfyre casts get.
    get look() {
      return look === "sculpted" && sculptedState !== "ready" ? `sculpted (${sculptedState})` : look;
    },
    nextLook() {
      look = LOOKS[(LOOKS.indexOf(look) + 1) % LOOKS.length];
      prepare(look);
    },
    sync(duel) {
      const time = performance.now() / 1000; // for whips that ripple, bodies that slither, jaws that snap (only looks)
      duel.wizards.forEach((wizard, i) => whips[i] && whips[i].sync(wizard, time, wizard.whip ? wandTip(i) : null));

      for (const serpent of duel.serpents) {
        if (!serpents.has(serpent)) {
          const name = duel.wizards[serpent.owner].data.special;
          const looks = { fire: fires[name], headFire: headFires[name], eyes, beast, sculpted: sculpted?.looks, glow, effects };
          serpents.set(serpent, creator()(scene, serpent, duel, looks, wandTip(serpent.owner)));
        }
        serpents.get(serpent).sync(serpent, time);
      }
      const alive = new Set(duel.serpents);
      for (const [serpent, view] of serpents) {
        if (alive.has(serpent)) continue;
        view.dispose();
        serpents.delete(serpent);
      }
    },
  };
}
