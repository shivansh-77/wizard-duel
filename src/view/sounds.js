import { CreateAudioEngineAsync, CreateSoundAsync } from "@babylonjs/core";

// Sound effects, made from maths instead of recorded files (nothing downloaded, so no licences to
// check), played through Babylon's audio engine ("Audio Engine V2", built on the browser's WebAudio).
//
// A sound is a long list of numbers between -1 and 1, the "samples": where the speaker should be
// at each instant, SAMPLE_RATE times per second. Each effect fills such a list by mixing a few
// layers (tones, noise), each with its own envelope (see the building blocks at the bottom).

// The effects, by name: each name → the function that builds it (the makers are further down).
const MAKERS = {
  cast: makeCast, // a bolt leaves the wand
  hit: makeHit, // a bolt hits a wizard
  block: makeBlock, // a bolt hits the Protego shield
  reflect: makeReflect, // a perfectly timed block sends the bolt back
  shield: makeShield, // Protego goes up
  apparate: makeApparate, // the crack of apparition
  ko: makeKo, // a wizard is knocked out
  // The beam clash (Priori Incantatem):
  beam: makeBeam, // a beam bursts out of the wand
  clash: makeClash, // two beams lock together
  push: makePush, // one press while mashing to push the meeting point (repeats fast, so it's tiny)
  burst: makeBurst, // the clash ends in an explosion
  // The specials:
  whip: makeWhip, // Dumbledore's fire whip lashes across
  serpent: makeSerpent, // Voldemort's Fiendfyre serpent bursts out
  fireOut: makeFireOut, // the serpent is put out
};

const SAMPLE_RATE = 48000; // samples per second: what most sound hardware runs at (the browser converts if not)
const PITCH_VARIATION = 0.05; // play() makes each sound up to 5% faster or slower, so repeats don't sound robotic

// Starts Babylon's audio engine and turns every effect into a sound it can play. Resolves, once
// all of them are ready, to { play(name), toggleMute() }.
export async function createSounds() {
  // The audio engine: every sound goes through it to the speakers. disableDefaultUI: without it,
  // Babylon shows its own "unmute" button in the corner until the audio is unlocked; we unlock it
  // ourselves instead (unlockOnFirstInput, below).
  const engine = await CreateAudioEngineAsync({ disableDefaultUI: true });
  unlockOnFirstInput(engine);

  // One StaticSound per effect: a sound kept whole in memory, so it starts at once (right for short
  // effects; long music would be a StreamingSound).
  const sounds = new Map(); // name → StaticSound (a Map, so a name like "toString" finds nothing)
  for (const name of Object.keys(MAKERS)) {
    const samples = synthesize(name, SAMPLE_RATE);
    // An AudioBuffer is the browser's container for raw samples; ours have 1 channel (mono).
    const buffer = new AudioBuffer({ length: samples.length, sampleRate: SAMPLE_RATE, numberOfChannels: 1 });
    buffer.copyToChannel(samples, 0);
    // CreateSoundAsync uses the audio engine created last: the one above.
    sounds.set(name, await CreateSoundAsync(name, buffer));
  }

  let muted = false;

  return {
    // Plays one effect. Never throws: unknown names are ignored, and so is every call before the
    // audio is unlocked (a sound played while the engine is locked never starts, but Babylon would
    // count it as playing forever).
    play(name) {
      const sound = sounds.get(name);
      if (!sound || engine.state !== "running") return;
      try {
        // A random speed between 0.95 and 1.05: faster also sounds higher, like a record spun
        // faster. (Math.random is fine here: this is the view, not gameplay.) playbackRate also
        // changes the copies of this sound that are still playing, so only pick a new one when
        // none is, or they would jump in pitch mid-sound.
        if (sound.activeInstancesCount === 0) {
          sound.playbackRate = 1 + (Math.random() * 2 - 1) * PITCH_VARIATION;
        }
        sound.play();
      } catch (error) {
        console.warn(`Sound "${name}" could not play:`, error); // a sound must never stop the game
      }
    },

    // Mutes or unmutes everything, and returns true if it's now muted. The engine's volume scales
    // every sound it plays (Babylon eases the change over 10 ms, so it doesn't click).
    toggleMute() {
      muted = !muted;
      engine.volume = muted ? 0 : 1;
      return muted;
    },
  };
}

// Browsers keep a page silent until the player interacts with it (their "autoplay policy"), so
// the engine starts locked ("suspended"). unlockAsync() asks the browser to start it, which it
// allows during a key press or a click. Once is enough.
function unlockOnFirstInput(engine) {
  const unlock = () => {
    window.removeEventListener("keydown", unlock);
    window.removeEventListener("pointerdown", unlock);
    // If the browser still says no, play() just stays silent (Babylon also retries on every click).
    engine.unlockAsync().catch(() => {});
  };
  window.addEventListener("keydown", unlock);
  window.addEventListener("pointerdown", unlock);
}

// The samples of one effect: a Float32Array (a list of decimal numbers), sampleRate per second.
// Pure maths, no browser needed, so it can be tested in Node.
export function synthesize(name, sampleRate = SAMPLE_RATE) {
  if (!Object.hasOwn(MAKERS, name)) throw new Error(`Unknown sound effect "${name}"`);
  return MAKERS[name](sampleRate);
}

// ---- The effects ----
// Each one builds a few layers, gives each its own envelope, mixes them, then finishes the mix at
// its own loudness (`peak`, at most 1). Peaks stay well below 1 because sounds that overlap add
// up: a KO always comes with a hit.

// A bolt leaves the wand: a buzzy "pew" diving in pitch, sparks fizzing off the wand, and a soft
// whoosh of air.
function makeCast(sampleRate) {
  const seconds = 0.25;
  const zap = tone(sampleRate, seconds, { wave: saw, from: 1400, to: 280, glide: 0.2 });
  lowPass(zap, sampleRate, 5000); // takes the harshest edge off the buzz
  envelope(zap, sampleRate, { attack: 0.004, halfLife: 0.06 });

  const fizz = crackle(sampleRate, seconds, 300);
  highPass(fizz, sampleRate, 3000);
  envelope(fizz, sampleRate, { attack: 0.002, halfLife: 0.05 });

  const air = noise(sampleRate, seconds);
  lowPass(air, sampleRate, 2500); // noise without its highs and its lows: a "whoosh"
  highPass(air, sampleRate, 400);
  envelope(air, sampleRate, { attack: 0.04, halfLife: 0.05 });

  return finish(mix([[zap, 1], [fizz, 0.4], [air, 0.6]]), sampleRate, 0.45);
}

// A bolt hits a wizard: a punchy thump (a low tone dropping fast, like a kick drum), the slap of
// the impact (a short burst of noise) and a crackle of magic sparks.
function makeHit(sampleRate) {
  const seconds = 0.3;
  const thump = tone(sampleRate, seconds, { from: 200, to: 55, glide: 0.08 });
  envelope(thump, sampleRate, { attack: 0.002, halfLife: 0.06 });

  const slap = noise(sampleRate, seconds);
  lowPass(slap, sampleRate, 4000);
  envelope(slap, sampleRate, { attack: 0.001, halfLife: 0.012 });

  const sparks = crackle(sampleRate, seconds, 250);
  highPass(sparks, sampleRate, 1500);
  envelope(sparks, sampleRate, { attack: 0.002, halfLife: 0.07 });

  return finish(mix([[thump, 1], [slap, 0.6], [sparks, 0.5]]), sampleRate, 0.6);
}

// A bolt hits the Protego shield: a glassy "ting" (see ting, below).
function makeBlock(sampleRate) {
  return finish(ting(sampleRate, 0.4, 1700, 1), sampleRate, 0.5);
}

// A perfectly timed block sends the bolt back: a higher, brighter ting, and a tone sweeping up
// ("fwiip!") as the bolt flies back where it came from.
function makeReflect(sampleRate) {
  const seconds = 0.45;
  const glass = ting(sampleRate, seconds, 2400, 1.5);

  const rise = tone(sampleRate, seconds, { from: 500, to: 3000, glide: 0.3 });
  envelope(rise, sampleRate, { start: 0.02, attack: 0.08, halfLife: 0.08 });

  return finish(mix([[glass, 1], [rise, 0.5]]), sampleRate, 0.55);
}

// Protego goes up: a soft, warm hum rising from 220 to 330 Hz, its octave, and a quiet shimmer,
// all swelling in gently instead of starting with a hit.
function makeShield(sampleRate) {
  const seconds = 0.3;
  const hum = tone(sampleRate, seconds, { wave: saw, from: 220, to: 330 });
  lowPass(hum, sampleRate, 900); // a saw with its buzz smoothed off: warm
  const octave = tone(sampleRate, seconds, { from: 440, to: 660 });
  // Two high tones 7 to 10 Hz apart: they drift in and out of step that many times a second, a shimmer.
  const shimmer = mix([
    [tone(sampleRate, seconds, { from: 1320, to: 1980 }), 1],
    [tone(sampleRate, seconds, { from: 1327, to: 1990 }), 1],
  ]);
  const air = noise(sampleRate, seconds);
  lowPass(air, sampleRate, 1500);

  for (const layer of [hum, octave, shimmer, air]) {
    envelope(layer, sampleRate, { attack: 0.12, halfLife: 0.08 });
  }
  return finish(mix([[hum, 1], [octave, 0.5], [shimmer, 0.25], [air, 0.2]]), sampleRate, 0.35);
}

// Apparition: a sharp crack (a very short burst of bright noise), then a quick low "whump" as air
// rushes into the space the wizard left.
function makeApparate(sampleRate) {
  const seconds = 0.3;
  const crack = noise(sampleRate, seconds);
  highPass(crack, sampleRate, 1200);
  envelope(crack, sampleRate, { attack: 0.0005, halfLife: 0.008 });

  const whump = tone(sampleRate, seconds, { from: 150, to: 45, glide: 0.1 });
  envelope(whump, sampleRate, { attack: 0.004, halfLife: 0.05 });

  const rush = noise(sampleRate, seconds);
  lowPass(rush, sampleRate, 300);
  lowPass(rush, sampleRate, 300); // twice: a steeper filter, a darker rumble
  envelope(rush, sampleRate, { attack: 0.01, halfLife: 0.04 });

  return finish(mix([[crack, 1], [whump, 0.8], [rush, 0.6]]), sampleRate, 0.55);
}

// A wizard is knocked out: a low boom (a deep rumble and a very low thump) under a buzzy tone
// that slides down two octaves, the sound of defeat.
function makeKo(sampleRate) {
  const seconds = 0.8;
  const rumble = noise(sampleRate, seconds);
  lowPass(rumble, sampleRate, 200);
  lowPass(rumble, sampleRate, 200);
  envelope(rumble, sampleRate, { attack: 0.005, halfLife: 0.2 });

  const boom = tone(sampleRate, seconds, { from: 110, to: 40, glide: 0.3 });
  envelope(boom, sampleRate, { attack: 0.004, halfLife: 0.15 });

  const fall = tone(sampleRate, seconds, { wave: saw, from: 440, to: 110 });
  lowPass(fall, sampleRate, 1200); // a darker, rounder buzz
  envelope(fall, sampleRate, { attack: 0.02, halfLife: 0.25 });

  return finish(mix([[rumble, 1], [boom, 0.9], [fall, 0.5]]), sampleRate, 0.5);
}

// ---- The beam clash ----

// A beam bursts out of the wand and keeps flowing: a buzzy hum leaping from 180 to 300 Hz (two saws
// a few Hz apart, so it throbs like flowing energy), a bright rush of noise as it bursts out, and
// crackle that grows as it flows.
function makeBeam(sampleRate) {
  const seconds = 0.5;
  const hum = mix([
    [tone(sampleRate, seconds, { wave: saw, from: 180, to: 300, glide: 0.12 }), 1],
    [tone(sampleRate, seconds, { wave: saw, from: 185, to: 308, glide: 0.12 }), 1],
  ]);
  lowPass(hum, sampleRate, 1500); // buzzy, but not harsh
  envelope(hum, sampleRate, { attack: 0.04, hold: 0.2, halfLife: 0.07 }); // up fast, flows, then fades

  const rush = noise(sampleRate, seconds);
  highPass(rush, sampleRate, 2000);
  envelope(rush, sampleRate, { attack: 0.01, halfLife: 0.07 });

  const crackling = crackle(sampleRate, seconds, 400);
  highPass(crackling, sampleRate, 2000);
  envelope(crackling, sampleRate, { attack: 0.25, hold: 0.05, halfLife: 0.05 }); // grows as it flows

  return finish(mix([[hum, 1], [rush, 0.5], [crackling, 0.4]]), sampleRate, 0.45);
}

// Two beams lock together: a tense chord. Two buzzy tones a semitone apart (one piano key, the
// most clashing step there is) rub against each other over a drone an octave lower. All three
// creep up a semitone as they swell, and sparks spit where the beams meet.
function makeClash(sampleRate) {
  const seconds = 0.9;
  const semitone = 2 ** (1 / 12); // one piano key up: 1.0595 times the frequency
  const chord = mix([
    [tone(sampleRate, seconds, { wave: saw, from: 110, to: 110 * semitone }), 0.8], // the drone
    [tone(sampleRate, seconds, { wave: saw, from: 220, to: 220 * semitone }), 1],
    [tone(sampleRate, seconds, { wave: saw, from: 220 * semitone, to: 220 * semitone ** 2 }), 1],
  ]);
  lowPass(chord, sampleRate, 1800);
  envelope(chord, sampleRate, { attack: 0.35, hold: 0.3, halfLife: 0.05 }); // a rising swell

  const sparks = crackle(sampleRate, seconds, 350);
  highPass(sparks, sampleRate, 2500);
  envelope(sparks, sampleRate, { attack: 0.02, hold: 0.65, halfLife: 0.06 });

  return finish(mix([[chord, 1], [sparks, 0.35]]), sampleRate, 0.55);
}

// One press while mashing to push the clash: a quick blip dropping in pitch, a little thud and a
// spark, soft so ten a second don't tire the ears. Only 0.07 s long: at ten presses a second each
// copy has ended before the next starts, so play() can give every press its own pitch (a longer
// one would still be playing at the next press, and the whole mash would keep one pitch).
function makePush(sampleRate) {
  const seconds = 0.07;
  const blip = tone(sampleRate, seconds, { from: 1100, to: 500, glide: 0.04 });
  envelope(blip, sampleRate, { attack: 0.002, halfLife: 0.012 });

  const thud = tone(sampleRate, seconds, { from: 180, to: 90, glide: 0.04 });
  envelope(thud, sampleRate, { attack: 0.002, halfLife: 0.015 });

  const spark = crackle(sampleRate, seconds, 300);
  highPass(spark, sampleRate, 2500);
  envelope(spark, sampleRate, { attack: 0.001, halfLife: 0.012 });

  return finish(mix([[blip, 1], [thud, 0.7], [spark, 0.3]]), sampleRate, 0.3);
}

// The clash ends in an explosion: a big blast of noise, a very low boom over a rumble, and a long
// shimmering ring as the magic dies away (a high chord whose notes have twins a few Hz off).
function makeBurst(sampleRate) {
  const seconds = 1;
  const blast = noise(sampleRate, seconds);
  lowPass(blast, sampleRate, 6000);
  envelope(blast, sampleRate, { attack: 0.003, halfLife: 0.08 });

  const boom = tone(sampleRate, seconds, { from: 80, to: 30, glide: 0.4 });
  envelope(boom, sampleRate, { attack: 0.005, halfLife: 0.2 });

  const rumble = noise(sampleRate, seconds);
  lowPass(rumble, sampleRate, 150);
  lowPass(rumble, sampleRate, 150); // twice: a steeper filter, a darker rumble
  envelope(rumble, sampleRate, { attack: 0.01, halfLife: 0.15 });

  const ring = mix([
    [tone(sampleRate, seconds, { from: 880 }), 1],
    [tone(sampleRate, seconds, { from: 884 }), 0.7], // a twin 4 Hz off: together they shimmer
    [tone(sampleRate, seconds, { from: 1320 }), 0.6],
    [tone(sampleRate, seconds, { from: 1325 }), 0.4],
    [tone(sampleRate, seconds, { from: 1760 }), 0.4],
  ]);
  envelope(ring, sampleRate, { start: 0.05, attack: 0.15, halfLife: 0.2 }); // rings in as the blast fades

  return finish(mix([[blast, 1], [boom, 0.9], [rumble, 0.7], [ring, 0.35]]), sampleRate, 0.6);
}

// ---- The specials ----

// Dumbledore's fire whip lashes across: a fiery whoosh that gets brighter as the lash swings (noise
// through a low-pass whose cutoff rises), then the CRACK of the tip at 0.3 s (a burst of bright
// noise plus a click), with a little fire crackling all along.
function makeWhip(sampleRate) {
  const seconds = 0.5;
  const crackAt = 0.3; // when the tip snaps
  const swing = noise(sampleRate, seconds);
  lowPass(swing, sampleRate, 250, 12000); // the cutoff slides up: dull, then brighter and brighter
  envelope(swing, sampleRate, { attack: crackAt, halfLife: 0.04 }); // swells until the crack

  const crack = noise(sampleRate, seconds);
  highPass(crack, sampleRate, 2500);
  envelope(crack, sampleRate, { start: crackAt, attack: 0.0005, halfLife: 0.008 });

  const click = tone(sampleRate, seconds, { from: 1500 }); // a few cycles of a tone: a click
  envelope(click, sampleRate, { start: crackAt, attack: 0.0003, halfLife: 0.0015 });

  const fire = crackle(sampleRate, seconds, 120);
  highPass(fire, sampleRate, 1500);
  envelope(fire, sampleRate, { attack: 0.05, hold: 0.25, halfLife: 0.08 });

  return finish(mix([[swing, 0.6], [crack, 1], [click, 0.6], [fire, 0.25]]), sampleRate, 0.5);
}

// Voldemort's Fiendfyre serpent bursts out: a deep roar of fire (dark noise whose loudness wobbles
// 8 times a second, a growl), a hiss rising over it, and crackling flames.
function makeSerpent(sampleRate) {
  const seconds = 0.9;
  const flames = { attack: 0.06, hold: 0.5, halfLife: 0.1 }; // bursts out, roars, dies down
  const roar = noise(sampleRate, seconds);
  lowPass(roar, sampleRate, 500);
  lowPass(roar, sampleRate, 500); // twice: deeper
  wobble(roar, sampleRate, 8, 0.6); // the growl
  envelope(roar, sampleRate, flames);

  const hiss = noise(sampleRate, seconds);
  lowPass(hiss, sampleRate, 2000, 9000); // the cutoff slides up: the hiss rises
  highPass(hiss, sampleRate, 1500);
  envelope(hiss, sampleRate, { attack: 0.5, hold: 0.1, halfLife: 0.08 });

  const crackling = crackle(sampleRate, seconds, 200);
  highPass(crackling, sampleRate, 1500);
  envelope(crackling, sampleRate, flames);

  return finish(mix([[roar, 1], [hiss, 0.4], [crackling, 0.35]]), sampleRate, 0.55);
}

// The serpent is put out: a short, soft thud as the flames collapse, then a steamy hiss (bright
// noise whose highs die down) fading away.
function makeFireOut(sampleRate) {
  const seconds = 0.45;
  const thud = tone(sampleRate, seconds, { from: 120, to: 60, glide: 0.05 });
  envelope(thud, sampleRate, { attack: 0.003, halfLife: 0.025 });

  const steam = noise(sampleRate, seconds);
  lowPass(steam, sampleRate, 12000, 4000); // the cutoff slides down: the hiss dulls as it dies
  highPass(steam, sampleRate, 2500);
  envelope(steam, sampleRate, { attack: 0.02, halfLife: 0.1 });

  return finish(mix([[steam, 1], [thud, 0.6]]), sampleRate, 0.4);
}

// A struck-glass "ting", shared by block and reflect. Its pure tones sit at 1, 2.76 and 5.4 times
// the base pitch, the uneven ratios of a struck metal bar: uneven ratios are what make it sound
// metallic instead of like a musical note. The higher ones fade faster, as in a real one, and a
// twin of the base tone 6 Hz higher drifts in and out of step with it: the shimmer.
// `brightness` turns the higher tones up or down.
function ting(sampleRate, seconds, pitch, brightness) {
  // A pure tone that starts at once and rings away, halving every halfLife seconds.
  const ring = (frequency, halfLife) => {
    const layer = tone(sampleRate, seconds, { from: frequency });
    return envelope(layer, sampleRate, { attack: 0.001, halfLife });
  };
  const strike = noise(sampleRate, seconds); // the tiny "tick" of the impact
  highPass(strike, sampleRate, 4000);
  envelope(strike, sampleRate, { attack: 0.0005, halfLife: 0.004 });

  return mix([
    [ring(pitch, 0.1), 1],
    [ring(pitch + 6, 0.1), 0.4],
    [ring(pitch * 2.76, 0.05), 0.5 * brightness],
    [ring(pitch * 5.4, 0.025), 0.3 * brightness],
    [strike, 0.3],
  ]);
}

// ---- Building blocks ----
// Each one makes a list of samples, or changes one in place (and returns it). `seconds` is a
// length, `sampleRate` how many samples make one second.

// Two wave shapes, given the "phase": how far through one cycle (one back-and-forth) the wave is,
// from 0 to 1. A sine is the smoothest, purest tone (a hum, a flute, a glass). A saw climbs, then
// drops straight back: a buzzy tone, full of overtones (the bite of a zap).
const sine = (phase) => Math.sin(2 * Math.PI * phase);
const saw = (phase) => 2 * phase - 1;

// Silence: a list of zeros of the right length, for the blocks below to fill in.
function silence(sampleRate, seconds) {
  return new Float32Array(Math.round(sampleRate * seconds));
}

// White noise: a new random value every sample. It hisses, like static or rushing air.
function noise(sampleRate, seconds) {
  const samples = silence(sampleRate, seconds);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return samples;
}

// Crackle: noise in short random sparks, like static or sparks off a wire. Every sample has a
// small chance of starting a spark (sparksPerSecond on average), and each spark dies in a few ms.
function crackle(sampleRate, seconds, sparksPerSecond) {
  const samples = silence(sampleRate, seconds);
  const fade = 0.5 ** (1 / (0.002 * sampleRate)); // per sample, so a spark halves every 2 ms
  let spark = 0; // the loudness of the current spark
  for (let i = 0; i < samples.length; i++) {
    if (Math.random() < sparksPerSecond / sampleRate) spark = 0.3 + 0.7 * Math.random();
    samples[i] = (Math.random() * 2 - 1) * spark;
    spark *= fade;
  }
  return samples;
}

// A tone with a frequency sweep. Its frequency (the pitch, in Hz: cycles per second) slides from
// `from` to `to` during the first `glide` seconds, then stays at `to`. A falling sweep sounds like
// "pew" or a thump, a rising one like "fwip" or something powering up. The slide is exponential
// (every octave takes the same time) because that's how ears hear pitch.
function tone(sampleRate, seconds, { wave = sine, from, to = from, glide = seconds }) {
  const samples = silence(sampleRate, seconds);
  let phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const progress = Math.min(i / sampleRate / glide, 1); // 0 → 1 during the slide
    const frequency = from * (to / from) ** progress;
    samples[i] = wave(phase);
    // Step through the cycle at the current frequency. Adding up small steps (instead of
    // computing frequency × time) keeps the wave smooth while its frequency changes.
    phase = (phase + frequency / sampleRate) % 1;
  }
  return samples;
}

// Low-pass filter: keeps the low frequencies and softens the high ones. Each sample only moves
// part of the way toward the input, so slow movements (a rumble) get through and fast wiggles
// (hiss, buzz) are smoothed away. `cutoff` (Hz) is roughly where the softening starts. Give a
// `cutoffEnd` too and the cutoff slides there over the whole sound (a filter sweep, like the
// frequency sweep of a tone): on noise, a rising cutoff sounds like a whoosh swinging past.
function lowPass(samples, sampleRate, cutoff, cutoffEnd = cutoff) {
  // The part of the way each sample moves (0 to 1) for a given cutoff frequency.
  const stepFor = (frequency) => 1 - Math.exp((-2 * Math.PI * frequency) / sampleRate);
  let step = stepFor(cutoff);
  let value = 0;
  for (let i = 0; i < samples.length; i++) {
    if (cutoffEnd !== cutoff) step = stepFor(cutoff * (cutoffEnd / cutoff) ** (i / samples.length)); // sliding
    value += (samples[i] - value) * step;
    samples[i] = value;
  }
  return samples;
}

// High-pass filter: the opposite. It keeps only what the low-pass would remove, the crisp,
// bright part ("tss", "crack").
function highPass(samples, sampleRate, cutoff) {
  const low = lowPass(samples.slice(), sampleRate, cutoff); // slice(): filter a copy
  for (let i = 0; i < samples.length; i++) samples[i] -= low[i];
  return samples;
}

// An envelope: the loudness of a sound over time. It swells from silence to full volume in
// `attack` seconds (0.001 = an instant "tick", 0.1 = a soft swell), stays there for `hold` seconds,
// then fades away, halving every `halfLife` seconds (small = a short "tock", big = a long ring).
// `start` delays it.
function envelope(samples, sampleRate, { attack, hold = 0, halfLife, start = 0 }) {
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate - start; // seconds since this layer began
    let volume = 0; // not started yet
    if (t >= 0 && t < attack) volume = t / attack; // swelling
    else if (t >= attack) volume = 0.5 ** (Math.max(0, t - attack - hold) / halfLife); // holding, then fading
    samples[i] *= volume;
  }
  return samples;
}

// A wobble (musicians say "tremolo"): the loudness dips and comes back `rate` times a second, by up
// to `depth` (0 = steady, 1 = all the way to silence). On a low roar it sounds like a growl.
function wobble(samples, sampleRate, rate, depth) {
  for (let i = 0; i < samples.length; i++) {
    const dip = 0.5 + 0.5 * Math.sin(2 * Math.PI * rate * (i / sampleRate)); // 0 → 1 → 0, `rate` times a second
    samples[i] *= 1 - depth * dip;
  }
  return samples;
}

// Scales a sound so its loudest sample is `peak` (1 = as loud as a sample can be).
function normalize(samples, peak) {
  let loudest = 0;
  for (const value of samples) loudest = Math.max(loudest, Math.abs(value));
  if (loudest > 0) {
    for (let i = 0; i < samples.length; i++) samples[i] *= peak / loudest;
  }
  return samples;
}

// Adds layers (all the same length) together, each at its own volume: mix([[zap, 1], [air, 0.5]]).
// Each layer is first scaled so its loudest moment is that volume: a filter can make a layer much
// quieter, and this way the volumes compare like with like.
function mix(layers) {
  const out = new Float32Array(layers[0][0].length);
  for (const [samples, volume] of layers) {
    normalize(samples, volume);
    for (let i = 0; i < out.length; i++) out[i] += samples[i];
  }
  return out;
}

// The last touch for every effect: a quick fade at both ends (a sound that starts or stops in the
// middle of a wave makes a "click"), then the whole effect scaled to its loudness, `peak`.
function finish(samples, sampleRate, peak) {
  const fadeIn = Math.round(0.002 * sampleRate); // 2 ms
  const fadeOut = Math.round(0.02 * sampleRate); // 20 ms
  const last = samples.length - 1;
  for (let i = 0; i < samples.length; i++) {
    samples[i] *= Math.min(1, i / fadeIn, (last - i) / fadeOut);
  }
  return normalize(samples, peak);
}
