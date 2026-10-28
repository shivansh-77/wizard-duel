import { Color3, StandardMaterial } from "@babylonjs/core";

// A plain one-colour material. (Textured ones add a diffuseTexture: see the floor in view/arena.js.)
// `shine` is the strength of the shiny highlight: 0 = matte stone, 1 = polished metal.
export function createMaterial(name, hex, scene, shine = 0.1) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.FromHexString(hex);
  material.specularColor = new Color3(shine, shine, shine);
  return material;
}

// A material made of light: only its emissive colour shows (lights don't change it), and the
// GlowLayer gives it a halo.
export function createGlowMaterial(name, hex, scene) {
  const material = new StandardMaterial(name, scene);
  material.emissiveColor = Color3.FromHexString(hex);
  material.disableLighting = true;
  return material;
}
