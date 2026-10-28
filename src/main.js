// Entry point: build the scene, then run the duel every frame.
import { Engine, Scene } from "@babylonjs/core";
import { WIZARDS } from "./data/wizards.js";
import { cpuInput, createCpu } from "./game/cpu.js";
import { createDuel, stepDuel } from "./game/duel.js";
import { createFixedStep } from "./game/fixed_step.js";
import { onMenuKey, readInput } from "./input/keyboard.js";
import { createOnline, modeOfCode } from "./net/online.js";
import { createArena } from "./view/arena.js";
import { setupAtmosphere } from "./view/atmosphere.js";
import { createBeamViews } from "./view/beams.js";
import { createBoltViews } from "./view/bolts.js";
import { createCamera } from "./view/camera.js";
import { createEffects } from "./view/effects.js";
import { createHud } from "./view/hud.js";
import { createLighting } from "./view/lighting.js";
import { createPostEffects } from "./view/post.js";
import { createReactions } from "./view/reactions.js";
import { createJoinBox } from "./view/join_box.js";
import { createMenu } from "./view/menu.js";
import { createSounds } from "./view/sounds.js";
import { createSpecialViews } from "./view/specials.js";
import { createSpellLights } from "./view/spell_lights.js";
import { createWandGlows } from "./view/wand_glow.js";
import { createWizard, syncWizard, useModel, wandTipPosition } from "./view/wizard.js";
import { loadWizardModel } from "./view/wizard_model.js";

const canvas = document.getElementById("renderCanvas");

// The Engine talks to the GPU (through WebGL) and draws into the canvas.
// `true` turns on antialiasing (smoother edges).
const engine = new Engine(canvas, true);

// The Scene holds everything we draw: meshes, lights, cameras.
const scene = new Scene(engine);

setupAtmosphere(scene);
const shadows = createLighting(scene);
const effects = createEffects(scene); // particles: the arena's braziers already need them
const arena = createArena(scene, shadows, effects);
effects.motes(); // dust floating in the air of the hall
const camera = createCamera(scene, arena.pillars);
const post = createPostEffects(scene, camera.camera);

// The duel's two wizards, always in this order: duel.wizards[0] is Dumbledore, [1] Voldemort.
const DUELLISTS = [WIZARDS.dumbledore, WIZARDS.voldemort];

// ---- Gameplay: the rules' state, advanced in fixed 1/60 s steps ----
let duel;
let cpu;
let duelCount = 0;
let you = 0; // the wizard player 1 (you, on WASD) plays: 0 Dumbledore, 1 Voldemort (picked in the menu)
// The mode of this duel, from the menu: "cpu", "training" (player 2 on the arrows), "quick" or "room"
// (online: the lockstep runs it).
let mode = "cpu";
let cpuOn = true; // the CPU plays the other wizard (not in Training; online only if your friend leaves)

function startDuel() {
  duel = createDuel(DUELLISTS);
  cpu = createCpu(duelCount++); // a new seed each duel, so the CPU doesn't repeat itself
}
startDuel();

// Keys are screen-relative, so they're read with the camera's directions along the floor
// (camera is created above; its directions change as it turns). Player 1's keys drive your wizard;
// the CPU or player 2's keys drive the other. The rules just get one input per wizard, in order.
// In an online duel the lockstep (net/lockstep.js) runs the step instead: your keys, and your
// friend's from the network, once both have arrived.
const advance = createFixedStep(() => {
  const axes = camera.groundAxes();
  if (online.lockstep) {
    online.lockstep.tick(duel, () => readInput("p1", axes));
    return;
  }
  const inputs = [];
  inputs[you] = readInput("p1", axes);
  inputs[1 - you] = cpuOn ? cpuInput(cpu, duel, 1 - you) : readInput("p2", axes);
  stepDuel(duel, inputs);
});

// ---- Looks and sound: they read the rules' state and react to its events ----
const wizardViews = DUELLISTS.map((data) => createWizard(scene, shadows, data));

// Real models load in the background. Until one arrives (or if its file is missing) that wizard's
// stand-in plays: the rules don't care which one is on screen.
DUELLISTS.forEach((data, i) => {
  loadWizardModel(scene, shadows, data, wizardViews[i].body)
    .then((model) => useModel(wizardViews[i], model))
    .catch((error) => console.warn(`${data.name} keeps his stand-in:`, error.message));
});
// Spells are drawn starting from where wizard i's wand tip is on screen (stand-in or real model).
const wandTip = (i) => wandTipPosition(wizardViews[i]);
const boltViews = createBoltViews(scene, wandTip, effects);
const beamViews = createBeamViews(scene, DUELLISTS, effects, wandTip);
const specialViews = createSpecialViews(scene, DUELLISTS, effects, wandTip);
const wandGlows = createWandGlows(scene, DUELLISTS, effects, wandTip);
const spellLights = createSpellLights(scene);
const hud = createHud();

// The menu (view/menu.js): the duel waits behind it. Its main screen picks a mode; vs CPU and Training
// then pick your wizard; Quick duel and Room host or join, and the host picks once his friend is here.
const MENU_MODES = ["cpu", "training", "quick", "room"]; // keys 1–4 on the main screen
const isOnline = (screen) => screen === "quick" || screen === "room";
const menu = createMenu(DUELLISTS, {
  onMode: (screen) => menu.open(screen),
  onWizard: (index) => choose(index),
  onHost: () => online.host(menu.screen),
});
function choose(index) {
  const screen = menu.screen;
  if (isOnline(screen)) {
    // Online, the host picks for both (his friend gets the other wizard) and the duel starts on both.
    if (online.connected && online.isHost) online.start(index);
    return;
  }
  if (screen === "cpu" || screen === "training") play(index, screen);
}
// A new duel in `newMode` with you as wizard `index`, your wizard on the left.
function play(index, newMode) {
  you = index;
  mode = newMode;
  cpuOn = mode !== "training";
  menu.hide();
  startDuel();
  camera.setPlayer(you);
  camera.reset();
}
// Esc in the menu: one screen back (leaving an online screen leaves the online game).
function back() {
  if (menu.screen === "main") return;
  if (isOnline(menu.screen)) online.leave();
  menu.open("main");
}

// ---- Online (net/online.js): Quick duel (PeerJS) or Room (Cloudflare), then lockstep with a friend ----
const online = createOnline({
  onStart: (index) => play(index, online.mode),
  onLeft: () => {
    cpuOn = true; // the CPU takes over your friend's wizard
  },
});
// Two ways to join a friend's game: type the code in the box at the top of an online screen, or open
// the game with ?join=CODE at the end of the address (not on itch.io, where the game runs in a frame).
// The code's length says which mode it belongs to: a Room code typed in Quick duel opens Room.
function joinFriend(code) {
  const codeMode = modeOfCode(code);
  if (!online.mode && codeMode && codeMode !== menu.screen) menu.open(codeMode);
  online.join(code);
}
const joinBox = createJoinBox(joinFriend);
const joinCode = new URLSearchParams(location.search).get("join");
if (joinCode) joinFriend(joinCode.toUpperCase());

// Sounds load in the background; until then (or if the browser has no audio) play() does nothing.
const sounds = { play() {}, toggleMute: () => false };
createSounds()
  .then((loaded) => Object.assign(sounds, loaded))
  .catch((error) => console.warn("Sounds are off:", error));
let muted = false;

const react = createReactions({ effects, camera, post, wandGlows, wizardViews, sounds });

onMenuKey((action) => {
  if (menu.visible) {
    // In the menu: 1–4 pick a mode on the main screen, 1–2 a wizard elsewhere; H hosts; Esc goes back.
    const number = { pick1: 0, pick2: 1, pick3: 2, pick4: 3 }[action];
    if (number !== undefined && menu.screen === "main") menu.open(MENU_MODES[number]);
    else if (number !== undefined && number < 2) choose(number);
    if (action === "host" && isOnline(menu.screen)) online.host(menu.screen);
    if (action === "menu") back();
    if (action === "mute") muted = sounds.toggleMute();
    return;
  }
  if (online.lockstep) {
    // An online duel: only the host restarts (R) or goes back to pick again (Esc). The guest's Esc
    // leaves (the host's CPU takes over).
    if (online.isHost && action === "restart") online.start(you);
    if (action === "menu") {
      if (online.isHost) menu.open(online.mode);
      else {
        online.leave();
        menu.open("main");
      }
    }
  } else {
    if (action === "menu") menu.open(mode); // back to this mode's screen (choose again, or host again)
    if (action === "restart") {
      startDuel();
      camera.reset();
    }
  }
  if (action === "mute") muted = sounds.toggleMute();
  if (action === "view") camera.toggleView(); // the duel camera <-> behind your wizard
  if (action === "look") specialViews.nextLook(); // Fiendfyre: beast → sculpted → caterpillar (only looks)
});

// The render loop: Babylon calls this once per frame, as often as the screen refreshes.
engine.runRenderLoop(() => {
  const seconds = engine.getDeltaTime() / 1000; // this frame's duration (ms → s)
  if (!menu.visible) advance(seconds); // 1. run the gameplay steps this frame's time covers (paused in the menu)
  react(duel.events.splice(0)); // 2. sparks, flashes, sounds for what just happened
  wizardViews.forEach((view, i) => syncWizard(view, duel.wizards[i], seconds)); // 3. match the meshes to the rules
  camera.follow(duel, seconds); // the camera turns, backs off or swoops to frame the duel
  // The online screens: the join box (until you host or join), the news, the wizards once you can pick.
  joinBox.show(menu.visible && isOnline(menu.screen) && !online.mode);
  menu.setOnline(online.news, { picking: online.connected && online.isHost, hosting: online.mode !== null });
  const opponent = online.lockstep ? "friend" : cpuOn ? "cpu" : "player2";
  const waiting = online.lockstep !== null && online.lockstep.waiting() > 250; // a visible freeze
  // The HUD's connection line: during an online duel the comparison numbers, after it the news.
  const net = online.lockstep ? online.status : isOnline(mode) ? online.news.split("\n")[0] : "";
  hud.sync(duel, { you, opponent, muted, look: specialViews.look, online: net, waiting });
  scene.render(); // 4. animate the clips, then (spells, below), then draw
});

// Spells start at the wand tips, and the clips move the hands while Babylon animates, inside
// scene.render(). onAfterAnimationsObservable runs right after that and before anything is drawn,
// so bolts, beams, the whip and the wands' glow use this frame's pose, not the last one.
scene.onAfterAnimationsObservable.add(() => {
  boltViews.sync(duel.bolts);
  beamViews.sync(duel);
  specialViews.sync(duel);
  wandGlows.sync(duel, engine.getDeltaTime() / 1000);
  spellLights.sync(duel);
});

// Keep the picture sharp and the right shape when the window changes size.
window.addEventListener("resize", () => {
  engine.resize();
});

// For poking at the game from the browser's console (F12 → Console) while developing: wizardDuel.duel
// is the rules' state right now, wizardDuel.scene the Babylon scene, wizardDuel.online the online
// session. Only in `npm run dev`: Vite turns import.meta.env.DEV into false for `npm run build`, and the
// whole block is left out of the built game (nothing to poke at on itch.io or GitHub Pages).
if (import.meta.env.DEV) {
  window.wizardDuel = {
    scene,
    online,
    get duel() {
      return duel;
    },
  };
}
