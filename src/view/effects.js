import { Color3, Color4, DynamicTexture, ParticleSystem, Vector3 } from "@babylonjs/core";

// Particle effects: one-shot bursts (sparks when a bolt hits or is blocked, smoke when a wizard
// apparates), fountains (a steady spray of sparks where a beam touches something), and since
// step 14: fire on the braziers, sparkling bolt tails, wands gathering power, dust in the air.
// A ParticleSystem shoots many tiny flat images (particles) that move, change colour and fade out.
export function createEffects(scene) {
  const dot = createSoftDot(scene);

  // Removes a particle system once it has stopped and its last particle has faded (onAnimationEnd),
  // right after that frame. Not with Babylon's disposeOnStop: it calls dispose(), which by default
  // also disposes the system's texture, and every effect here shares one texture (the soft dot):
  // the first burst to finish wiped out every other particle effect. dispose(false) keeps it.
  function removeWhenDone(particles) {
    particles.onAnimationEnd = () => scene.onAfterRenderObservable.addOnce(() => particles.dispose(false));
  }

  // A burst that emits all its particles at once, then cleans itself up.
  function burst(name, position, count, setup) {
    const particles = new ParticleSystem(name, count, scene);
    particles.particleTexture = dot;
    particles.emitter = position;
    setup(particles);
    particles.manualEmitCount = count; // emit exactly this many, now, instead of a steady stream
    particles.targetStopDuration = 1; // stop after a second...
    removeWhenDone(particles); // ...and remove the system
    particles.start();
  }

  return {
    removeWhenDone,

    // Bright sparks flying out and falling, in a spell's colour.
    sparks(x, y, z, hex, count) {
      burst("sparks", new Vector3(x, y, z), count, (particles) => {
        particles.createSphereEmitter(0.1); // fly out in every direction from a small ball
        sparkLook(particles, hex);
      });
    },

    // A steady spray of sparks that keeps going between start() and stop(). Move it by changing
    // `particles.emitter` (a Vector3), recolour it with setSparkColor().
    fountain(hex, perSecond) {
      const particles = new ParticleSystem("fountain", perSecond, scene); // room for a second of sparks
      particles.particleTexture = dot;
      particles.emitter = new Vector3(0, -10, 0);
      particles.createSphereEmitter(0.08);
      sparkLook(particles, hex);
      particles.maxLifeTime = 0.3; // shorter-lived than a burst's: a fountain keeps making new ones
      particles.emitRate = perSecond; // particles born per second while it runs
      return particles;
    },

    // A fire that burns forever (the braziers): flames rise, shrink and fade from bright to dark.
    // sizeGradient: a particle's size over its life (0 = born, 1 = dies), as a share of its start size.
    flames(position, hex) {
      const particles = new ParticleSystem("flames", 80, scene);
      particles.particleTexture = dot;
      particles.emitter = position;
      // A box emitter: born anywhere inside a flat box (the bowl's surface), heading up-ish.
      particles.createBoxEmitter(new Vector3(-0.1, 1, -0.1), new Vector3(0.1, 1, 0.1), new Vector3(-0.25, 0, -0.25), new Vector3(0.25, 0.05, 0.25));
      const color = Color3.FromHexString(hex);
      particles.color1 = new Color4(color.r, color.g, color.b, 0.9);
      particles.color2 = new Color4(0.85, 1, 0.9, 0.9); // some white-hot
      particles.colorDead = new Color4(color.r * 0.2, color.g * 0.2, color.b * 0.2, 0);
      // With size gradients, the gradient's values are the sizes themselves (metres), not factors:
      // Babylon then ignores minSize and maxSize.
      particles.addSizeGradient(0, 0.5);
      particles.addSizeGradient(1, 0.08);
      particles.minLifeTime = 0.35;
      particles.maxLifeTime = 0.7;
      particles.minEmitPower = 1;
      particles.maxEmitPower = 2;
      particles.emitRate = 90;
      particles.gravity = new Vector3(0, 2.5, 0); // hot air rises
      particles.blendMode = ParticleSystem.BLENDMODE_ADD;
      particles.start();
      return particles;
    },

    // A sparkling tail behind something that moves (a bolt). The emitter is the mesh itself, so the
    // sparks are born wherever it is; they stay where they're born and fade, leaving a trail.
    // Stop it with stop(): it removes itself once its last sparks have faded.
    trail(mesh, hex) {
      const particles = new ParticleSystem("trail", 120, scene);
      particles.particleTexture = dot;
      particles.emitter = mesh;
      particles.createSphereEmitter(0.1);
      setSparkColor(particles, hex);
      particles.minSize = 0.04;
      particles.maxSize = 0.12;
      particles.minLifeTime = 0.15;
      particles.maxLifeTime = 0.35;
      particles.minEmitPower = 0.2;
      particles.maxEmitPower = 0.8;
      particles.emitRate = 110;
      particles.blendMode = ParticleSystem.BLENDMODE_ADD;
      removeWhenDone(particles);
      particles.start();
      return particles;
    },

    // Sparks drawn in toward a point (a wand charging up): born on a sphere around it, they fly
    // inward because their emit power is negative (a sphere emitter shoots outward). Start/stop it.
    gather(mesh, hex) {
      const particles = new ParticleSystem("gather", 80, scene);
      particles.particleTexture = dot;
      particles.emitter = mesh;
      particles.createSphereEmitter(0.55, 0); // radiusRange 0: born on the surface, not inside
      setSparkColor(particles, hex);
      particles.minSize = 0.04;
      particles.maxSize = 0.1;
      particles.minLifeTime = 0.22;
      particles.maxLifeTime = 0.28; // about the time to reach the middle
      particles.minEmitPower = -2.2;
      particles.maxEmitPower = -1.8;
      particles.emitRate = 160;
      particles.blendMode = ParticleSystem.BLENDMODE_ADD;
      return particles;
    },

    // Dust motes drifting in the air of the hall, catching the light: a few at a time, all over
    // the arena, slow and long-lived. A box emitter as big as the arena.
    motes() {
      const particles = new ParticleSystem("motes", 300, scene);
      particles.particleTexture = dot;
      particles.emitter = new Vector3(0, 0, 0);
      particles.createBoxEmitter(new Vector3(-1, 0.3, -1), new Vector3(1, 1, 1), new Vector3(-11, 0.2, -9), new Vector3(11, 5, 11));
      particles.color1 = new Color4(1, 0.9, 0.7, 0.5);
      particles.color2 = new Color4(0.7, 0.85, 1, 0.4);
      particles.colorDead = new Color4(1, 1, 1, 0);
      particles.minSize = 0.03;
      particles.maxSize = 0.08;
      particles.minLifeTime = 6;
      particles.maxLifeTime = 10;
      particles.minEmitPower = 0.03;
      particles.maxEmitPower = 0.12;
      particles.emitRate = 30;
      particles.blendMode = ParticleSystem.BLENDMODE_ADD;
      particles.preWarmCycles = 300; // fill the air before the first frame instead of starting empty
      particles.start();
      return particles;
    },

    // A puff of dark smoke for apparition.
    puff(x, z) {
      burst("puff", new Vector3(x, 0.9, z), 30, (particles) => {
        particles.createSphereEmitter(0.5);
        particles.color1 = new Color4(0.16, 0.16, 0.2, 0.85);
        particles.color2 = new Color4(0.3, 0.3, 0.35, 0.7);
        particles.colorDead = new Color4(0.1, 0.1, 0.12, 0);
        particles.minSize = 0.4;
        particles.maxSize = 0.9;
        particles.minLifeTime = 0.35;
        particles.maxLifeTime = 0.7;
        particles.minEmitPower = 0.5;
        particles.maxEmitPower = 1.5;
        particles.gravity = new Vector3(0, 1, 0); // smoke rises
        particles.blendMode = ParticleSystem.BLENDMODE_STANDARD; // normal see-through blending: smoke darkens
      });
    },
  };
}

// How sparks look: tinted with a colour (some white-hot), small, short-lived, falling, glowing.
function sparkLook(particles, hex) {
  setSparkColor(particles, hex);
  particles.minSize = 0.05;
  particles.maxSize = 0.16;
  particles.minLifeTime = 0.2;
  particles.maxLifeTime = 0.45;
  particles.minEmitPower = 2;
  particles.maxEmitPower = 6;
  particles.gravity = new Vector3(0, -9, 0);
  particles.blendMode = ParticleSystem.BLENDMODE_ADD; // overlapping sparks add up to brighter light
}

// Particles start between color1 and color2 and fade to colorDead (alpha 0 = see-through).
export function setSparkColor(particles, hex) {
  const color = Color3.FromHexString(hex);
  particles.color1 = new Color4(color.r, color.g, color.b, 1);
  particles.color2 = new Color4(1, 1, 1, 1); // some sparks white-hot
  particles.colorDead = new Color4(color.r, color.g, color.b, 0);
}

// The image every particle uses: a soft white dot, drawn in code on a DynamicTexture (a texture with
// a 2D canvas you can draw on) instead of loading a picture. Particles tint it with their colour.
function createSoftDot(scene) {
  const texture = new DynamicTexture("softDot", 64, scene, false);
  const context = texture.getContext();
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.35, "rgba(255, 255, 255, 0.7)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  texture.hasAlpha = true;
  texture.update();
  return texture;
}
