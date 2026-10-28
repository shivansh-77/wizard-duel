import { stepDuel } from "../game/duel.js";
import { checksum } from "../game/checksum.js";

// An online duel, the simple way: lockstep with an input delay.
//
// Each computer runs its own copy of the duel with the same rules (game/duel.js). The rules give the
// same result from the same inputs, so if both copies get exactly the same inputs, step by step, both
// screens show the same duel. Only inputs travel (a few bytes a step), never positions or health.
//
//   - Your input read at step N is used at step N + delay, and sent to your friend at once: it has
//     `delay` steps (3 = 50 ms; more for a far-away friend, see net/online.js) to arrive before anyone
//     needs it.
//   - A step only runs when BOTH players' inputs for it are here ("lockstep": the two games move
//     together). If your friend's input is late, your game waits for it (a brief freeze).
//   - Steps 0 to delay - 1 come before anyone could have pressed anything: both use "no input".
//   - Every CHECK_EVERY steps both send a checksum of their duel: different = out of sync.
//
// The later upgrade, rollback (roadmap step 24), never waits: it guesses the late input, runs on, and
// corrects itself when the real one arrives.

const CHECK_EVERY = 60; // steps: compare checksums once a second
const MAX_PER_TICK = 2; // when behind (inputs piled up), run up to 2 steps per tick to catch up

// The buttons in an input, in a fixed order: each becomes one bit of a number.
const BUTTONS = ["cast", "shield", "apparate", "beam", "special"];

// An input as three whole numbers, small to send and the same on both computers: x and z (the glide
// direction, from -1 to 1) in thousandths, and the buttons as bits.
export function pack(input) {
  let bits = 0;
  BUTTONS.forEach((button, i) => {
    if (input[button]) bits |= 1 << i;
  });
  return [Math.round(input.x * 1000), Math.round(input.z * 1000), bits];
}

export function unpack([x, z, bits]) {
  const input = { x: x / 1000, z: z / 1000 };
  BUTTONS.forEach((button, i) => {
    input[button] = (bits & (1 << i)) !== 0;
  });
  return input;
}

const NOTHING = unpack([0, 0, 0]);

// send(message): to the friend (net/peer.js). you: the index of your wizard in duel.wizards.
// delay: steps between reading an input and using it (the same on both computers).
// round: which online duel this is (a restart starts a new round; late messages from an old one are
// ignored). onDesync(step): the checksums didn't match.
export function createLockstep({ send, you, round, delay, onDesync }) {
  const mine = new Map(); // step → your input for it
  const theirs = new Map(); // step → your friend's input for it
  const sums = { mine: new Map(), theirs: new Map() }; // step → checksum
  for (let step = 0; step < delay; step++) {
    mine.set(step, NOTHING);
    theirs.set(step, NOTHING);
  }
  let next = 0; // the next step to run
  let waitingSince = null; // performance.now() when we started waiting for the friend, or null

  function compare(step) {
    if (!sums.mine.has(step) || !sums.theirs.has(step)) return;
    if (sums.mine.get(step) !== sums.theirs.get(step)) onDesync(step);
    sums.mine.delete(step);
    sums.theirs.delete(step);
  }

  return {
    round,
    delay,
    // Called by the fixed step (60 times a second). readMine() reads your keys now.
    tick(duel, readMine) {
      for (let n = 0; n < MAX_PER_TICK; n++) {
        if (!mine.has(next) || !theirs.has(next)) {
          if (n === 0 && waitingSince === null) waitingSince = performance.now();
          return; // your friend's input for this step isn't here yet: wait
        }
        waitingSince = null;
        const inputs = [];
        inputs[you] = mine.get(next);
        inputs[1 - you] = theirs.get(next);
        stepDuel(duel, inputs);
        mine.delete(next);
        theirs.delete(next);

        // Your input for `delay` steps from now: unpack(pack(...)) so you use exactly what your friend gets.
        const packed = pack(readMine());
        mine.set(next + delay, unpack(packed));
        send({ type: "input", round, step: next + delay, input: packed });

        if ((next + 1) % CHECK_EVERY === 0) {
          const sum = checksum(duel);
          sums.mine.set(next, sum);
          send({ type: "check", round, step: next, sum });
          compare(next);
        }
        next++;
        if (!theirs.has(next)) return; // not ahead of the friend: one step this tick is enough
      }
    },
    // A message from the friend (only this round's).
    receive(message) {
      if (message.round !== round) return;
      if (message.type === "input") theirs.set(message.step, unpack(message.input));
      if (message.type === "check") {
        sums.theirs.set(message.step, message.sum);
        compare(message.step);
      }
    },
    // How long we've been waiting for the friend, in ms (0 = not waiting).
    waiting() {
      return waitingSince === null ? 0 : performance.now() - waitingSince;
    },
    get step() {
      return next;
    },
  };
}
