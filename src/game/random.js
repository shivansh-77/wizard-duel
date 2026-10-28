// Seeded randomness for gameplay (the CPU's choices). Math.random gives different numbers on every
// run; this gives the SAME sequence every time for the same seed, so a duel can be replayed exactly
// (and, later, played the same on two machines online).
//
// It's "mulberry32", a tiny, well-known generator: each call scrambles a 32-bit number with
// multiplications and bit shifts, and the result looks random enough for a game.
export function createRandom(seed) {
  let state = seed >>> 0; // ">>> 0" keeps it a whole number from 0 to 2^32 - 1
  // Returns a number from 0 (included) to 1 (excluded), like Math.random.
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
