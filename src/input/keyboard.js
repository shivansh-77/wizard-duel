// Reads the keyboard and turns it into each player's input for one gameplay step:
// { x, z, cast, shield, apparate, beam, special }. Gameplay never looks at keys, only at these objects, so
// the CPU (game/cpu.js) or, later, a network player can drive a wizard the same way.
//
// Directions are screen-relative: right moves toward the screen's right, up moves away from the
// camera. The camera turns (view/camera.js), so the keys are turned with it into directions on the
// floor (x, z), which is what the rules use: they never know where the camera is.

// Which keys each player uses: the same spots as Alien Fight's attack / jump / defend / ultimate / speed.
// event.code names the physical key, so any keyboard layout works.
const BINDINGS = {
  p1: {
    left: ["KeyA"],
    right: ["KeyD"],
    up: ["KeyW"],
    down: ["KeyS"],
    cast: ["KeyJ"],
    apparate: ["KeyK"],
    shield: ["KeyL"],
    beam: ["KeyU"],
    special: ["ShiftLeft"],
  },
  p2: {
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
    up: ["ArrowUp"],
    down: ["ArrowDown"],
    cast: ["Period", "Numpad1"],
    apparate: ["Slash", "Numpad2"],
    shield: ["Quote", "Numpad3"],
    beam: ["Enter", "NumpadEnter"],
    special: ["Semicolon", "Numpad0"],
  },
};

// Keys outside the duel: they call the handler given to onMenuKey once per press.
const MENU_KEYS = {
  KeyR: "restart",
  KeyM: "mute",
  KeyV: "view",
  KeyF: "look",
  Escape: "menu", // back: to the menu during a duel, to the previous screen in the menu
  KeyH: "host", // on an online screen: host
  Digit1: "pick1", // in the menu: the first mode, or Dumbledore...
  Digit2: "pick2", // ...the second mode, or Voldemort
  Digit3: "pick3", // the third mode (Quick duel)
  Digit4: "pick4", // the fourth mode (Room)
};

const GAME_KEYS = new Set(Object.values(BINDINGS).flatMap((keys) => Object.values(keys).flat()));
const held = new Set(); // the codes of the keys held down right now
const menuHandlers = [];

window.addEventListener("keydown", (event) => {
  // Typing in a text box (the join code, view/join_box.js) is typing, not playing: no wizard moves and
  // no menu key fires.
  if (event.target instanceof HTMLInputElement) return;
  held.add(event.code);
  // Stop the browser's own use of our keys (arrows scroll, "/" and "'" open quick find in Firefox),
  // but leave shortcuts like Ctrl+R alone.
  const shortcut = event.ctrlKey || event.metaKey || event.altKey;
  if (GAME_KEYS.has(event.code) && !shortcut) event.preventDefault();
  const action = MENU_KEYS[event.code];
  if (action && !event.repeat && !shortcut) menuHandlers.forEach((handler) => handler(action));
});
window.addEventListener("keyup", (event) => held.delete(event.code));
// When the window loses focus, keyup never arrives: forget every key so no wizard keeps gliding.
window.addEventListener("blur", () => held.clear());

// One player's input for this step; the buttons are true while held. `axes` are the camera's
// directions along the floor (camera.groundAxes()): right = the screen's right, forward = away from
// the camera. The keys say how much of each (-1, 0 or +1; both = a diagonal), and x, z are the sum.
export function readInput(player, axes) {
  const keys = BINDINGS[player];
  const isHeld = (action) => keys[action].some((code) => held.has(code));
  const axis = (minus, plus) => (isHeld(plus) ? 1 : 0) - (isHeld(minus) ? 1 : 0);
  const across = axis("left", "right");
  const away = axis("down", "up");
  return {
    x: across * axes.right.x + away * axes.forward.x,
    z: across * axes.right.z + away * axes.forward.z,
    cast: isHeld("cast"),
    shield: isHeld("shield"),
    apparate: isHeld("apparate"),
    beam: isHeld("beam"),
    special: isHeld("special"),
  };
}

// Calls handler(action) once per press of a key in MENU_KEYS, with its action ("restart", "menu"...).
export function onMenuKey(handler) {
  menuHandlers.push(handler);
}
