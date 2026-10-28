import { Color4, DefaultRenderingPipeline, ImageProcessingConfiguration } from "@babylonjs/core";

const EXPOSURE = 1.15; // overall brightness
const CONTRAST = 1.3; // darks darker, lights lighter
const KICK_FADE = 3; // how fast a hit's jolt dies down (per second)

// Post-processing: effects applied to the whole finished picture, after the scene is drawn.
// DefaultRenderingPipeline bundles the common ones; we use:
// - tone mapping (ACES, the film-like curve games use): bright magic rolls off softly instead of
//   clipping to flat white, and colours look richer;
// - contrast and exposure;
// - a vignette: the corners darken, framing the duel;
// - FXAA: smooths jagged edges;
// - chromatic aberration: red, green and blue split apart a little, like a lens. Normally off;
//   kick() turns it up for a moment on big hits, a jolt you feel more than see.
export function createPostEffects(scene, camera) {
  // true = HDR: the picture is kept in high precision until tone mapping, so bright spells keep
  // their colour instead of all ending up white.
  const pipeline = new DefaultRenderingPipeline("post", true, scene, [camera]);
  pipeline.fxaaEnabled = true;

  pipeline.imageProcessingEnabled = true;
  const image = pipeline.imageProcessing;
  image.toneMappingEnabled = true;
  image.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  image.exposure = EXPOSURE;
  image.contrast = CONTRAST;
  image.vignetteEnabled = true;
  image.vignetteWeight = 2.2;
  image.vignetteStretch = 0.4;
  image.vignetteColor = new Color4(0.02, 0.02, 0.06, 0);

  pipeline.chromaticAberrationEnabled = true;
  pipeline.chromaticAberration.aberrationAmount = 0;

  let kick = 0; // 0 = calm, 1 = the biggest jolt
  scene.onBeforeRenderObservable.add(() => {
    kick = Math.max(0, kick - KICK_FADE * (scene.getEngine().getDeltaTime() / 1000));
    pipeline.chromaticAberration.aberrationAmount = kick * 80;
    image.exposure = EXPOSURE + kick * 0.5; // and a brief flash of light
  });

  return {
    kick(amount) {
      kick = Math.max(kick, amount);
    },
  };
}
