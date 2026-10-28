// Runs gameplay in fixed 1/60 s steps, whatever the screen's frame rate (the same idea as
// Alien Fight's fight_loop.js). Each frame adds the real time that passed to a "bank", then one
// step runs for every 1/60 s in the bank; the rest waits for the next frame. Real time only
// decides HOW MANY steps run: inside a step, time is always exactly 1/60 s, so the duel plays
// the same at 60, 120 or 144 Hz, and later on both machines of an online match.
export const STEP_SECONDS = 1 / 60;
const TOLERANCE = 0.002; // 2 ms: absorbs frame-timing jitter, so a 60 Hz screen gets exactly one step per frame
const MAX_STEPS_PER_FRAME = 5; // after a long pause (a hidden tab), don't try to catch up all at once

// Returns an `advance(elapsedSeconds)` function that calls `step()` the right number of times.
export function createFixedStep(step) {
  let bank = 0; // seconds of real time not yet turned into steps
  return function advance(elapsedSeconds) {
    bank = Math.min(bank + elapsedSeconds, STEP_SECONDS * MAX_STEPS_PER_FRAME);
    while (bank >= STEP_SECONDS - TOLERANCE) {
      bank -= STEP_SECONDS;
      step();
    }
  };
}
