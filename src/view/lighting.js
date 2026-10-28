import { Color3, DirectionalLight, GlowLayer, HemisphericLight, ShadowGenerator, Vector3 } from "@babylonjs/core";

// The scene's two lights, and the ShadowGenerator that turns the sun's light into shadows.
// Returns the ShadowGenerator: add a mesh to it to make that mesh cast a shadow.
export function createLighting(scene) {
  // HemisphericLight: soft light from the whole sky (and a little from below), so the sides
  // the sun misses aren't pitch black. Kept dim on purpose: a strong one washes the shadows out.
  const sky = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
  sky.intensity = 0.4;
  sky.diffuse = new Color3(0.6, 0.7, 1); // a cool, bluish fill
  sky.groundColor = new Color3(0.15, 0.12, 0.1); // light bouncing up from the floor
  sky.specular = Color3.Black(); // fill light shouldn't make shiny spots

  // DirectionalLight: parallel rays all going one way, like sunlight through a high window.
  // This one shines from high up, over the camera's right shoulder: the sides we look at are lit,
  // and shadows fall away from us, where they show each wizard's spot on the platform.
  const direction = new Vector3(-0.35, -1, 0.45);
  const sun = new DirectionalLight("sun", direction, scene);
  // Shadows also need a position for the light: back along its direction, outside the arena.
  sun.position = direction.scale(-20);
  // The shadow map only records what lies between shadowMinZ and shadowMaxZ metres from that position.
  // Without these, Babylon borrows the camera's range (1 to 10000 m), and changing the camera would
  // quietly change the shadows.
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 50;
  sun.diffuse = new Color3(1, 0.93, 0.8); // warm
  sun.intensity = 1.1;

  // ShadowGenerator: draws the scene from the sun's point of view into a 2048×2048 depth image
  // (the "shadow map"), then darkens every spot the sun can't see.
  const shadows = new ShadowGenerator(2048, sun);
  shadows.usePercentageCloserFiltering = true; // soft shadow edges instead of jagged ones
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  // A tiny depth offset that stops "shadow acne" (stripy self-shadows on surfaces that both cast and
  // receive). It's a fraction of the depth range, not metres: 0.002 × (50 − 1) / 2 ≈ 5 cm.
  shadows.bias = 0.002;

  // GlowLayer: everything with an emissive colour (bolts, Voldemort's eyes, Protego) gets a soft
  // halo of light around it. It's a post effect: Babylon blurs the bright parts and adds them back.
  const glow = new GlowLayer("glow", scene);
  glow.intensity = 0.8;

  return shadows;
}
