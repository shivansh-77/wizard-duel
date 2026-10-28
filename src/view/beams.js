import { Color3, MeshBuilder, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { BEAMS, CLASH, PROTEGO } from "../data/spells.js";
import { BOLT_HEIGHT } from "./bolts.js";
import { setSparkColor } from "./effects.js";

// Draws each wizard's beam and Priori Incantatem's golden meeting point. For a flowing beam the
// rules give where it ends (seen from above); the view stretches a glowing cylinder from the wand
// tip drawn now (wandTip(i), see view/wizard.js) to that end, at wand height. Sparks spray where a
// beam touches something.
export function createBeamViews(scene, wizards, effects, wandTip) {
  const beams = wizards.map((data) => createBeam(scene, data));

  const bead = MeshBuilder.CreateSphere("clashPoint", { diameter: 0.45, segments: 16 }, scene);
  bead.material = glowMaterial("clashPointMat", CLASH.color, scene);
  bead.isVisible = false;
  const clashSparks = effects.fountain(CLASH.color, 220);

  return {
    sync(duel) {
      const time = performance.now() / 1000; // for the flicker and the pulse (only looks)
      duel.wizards.forEach((wizard, i) => {
        const beam = beams[i];
        const flowing = wizard.beamStart !== null;
        beam.root.setEnabled(flowing);
        if (flowing) stretch(beam, wandTip(i), wizard.beamEnd, time + i);
        // Sparks where the beam touches the other wizard (its colour) or his Protego (blue).
        const contact = wizard.beamContact;
        spray(beam.sparks, contact, contact && contact.blocked ? PROTEGO.color : BEAMS[wizard.data.beam].color);
      });

      const point = duel.clash ? duel.clash.point : null;
      bead.isVisible = point !== null;
      if (point) {
        bead.position.set(point.x, BOLT_HEIGHT, point.z);
        bead.scaling.setAll(1 + 0.25 * Math.sin(time * 25)); // it throbs
      }
      spray(clashSparks, point, CLASH.color);
    },
  };

  // One beam: a glowing coloured cylinder with a thinner white-hot core inside.
  function createBeam(sceneArg, data) {
    const spell = BEAMS[data.beam];
    const root = new TransformNode(`${data.name}Beam`, sceneArg);
    const outer = MeshBuilder.CreateCylinder(`${data.name}BeamOuter`, { height: 1, diameter: spell.width, tessellation: 12 }, sceneArg);
    outer.material = glowMaterial(`${data.name}BeamMat`, spell.color, sceneArg);
    const core = MeshBuilder.CreateCylinder(`${data.name}BeamCore`, { height: 1, diameter: spell.width * 0.4, tessellation: 8 }, sceneArg);
    core.material = glowMaterial(`${data.name}BeamCoreMat`, "#ffffff", sceneArg);
    // Both are built 1 m long, laid along the root's +z, from the root (z = 0) to z = 1. Then
    // stretch() only has to place, turn and scale the root.
    for (const part of [outer, core]) {
      part.rotation.x = Math.PI / 2; // a cylinder stands upright when built: lay it along +z
      part.position.z = 0.5;
      part.parent = root;
    }
    root.setEnabled(false);
    return { root, sparks: effects.fountain(spell.color, 120) };
  }
}

// Places a beam's root at the wand tip (a Vector3), turns its +z toward the end point with lookAt(),
// and scales z to the beam's length: the 1 m cylinders inside stretch to fit. Its thickness flickers.
function stretch(beam, start, end, time) {
  beam.root.position.copyFrom(start);
  const target = new Vector3(end.x, BOLT_HEIGHT, end.z);
  const length = Vector3.Distance(beam.root.position, target);
  if (length < 0.01) return; // too short to aim
  beam.root.lookAt(target);
  const flicker = 1 + 0.18 * Math.sin(time * 40);
  beam.root.scaling.set(flicker, flicker, length);
}

// Runs a spark fountain at `point` (or stops it when point is null), in the given colour. We keep
// our own `on` flag: Babylon's isStarted() stays true after stop(), so it can't tell us.
function spray(particles, point, hex) {
  if (!point) {
    if (particles.on) particles.stop(); // no new sparks; the last ones fade out
    particles.on = false;
    return;
  }
  particles.emitter.set(point.x, BOLT_HEIGHT, point.z);
  if (particles.sparkColor !== hex) {
    setSparkColor(particles, hex);
    particles.sparkColor = hex; // remembered, so the colour is only set when it changes
  }
  if (!particles.on) particles.start();
  particles.on = true;
}

// A material made of light: only its emissive colour shows, and the GlowLayer makes it shine.
function glowMaterial(name, hex, scene) {
  const material = new StandardMaterial(name, scene);
  material.emissiveColor = Color3.FromHexString(hex);
  material.disableLighting = true;
  return material;
}
