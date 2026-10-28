import { AdvancedDynamicTexture, Button, Control, Rectangle, StackPanel, TextBlock } from "@babylonjs/gui";
import { ONLINE_MODES } from "../data/online.js";
import { SPECIALS } from "../data/spells.js";

// The opening menu, over the arena (Babylon GUI: its own full-screen layer on top of the HUD).
// Five screens, one shown at a time:
//   "main"      the four modes: vs CPU, Training, Quick duel, Room;
//   "cpu"       choose your wizard, the CPU plays the other;
//   "training"  choose player 1's wizard, player 2 (same keyboard) plays the other;
//   "quick"     online through PeerJS: host (a 4-character code) or join;
//   "room"      online through Cloudflare: host a room (a 5-character code) or join.
// Everything is a click (or a tap); keys do the same (main.js passes them in).
// actions: onMode(screen), onWizard(index), onHost().

const MODES = [
  { screen: "cpu", title: "vs CPU", about: "You against the computer.", color: "#ffd75e" },
  { screen: "training", title: "Training", about: "Two players, one keyboard: practise moves, test things.", color: "#9fd3ff" },
  { screen: "quick", title: "Quick duel", about: "Online with a friend, browser to browser (PeerJS).", color: "#8ef0a8" },
  { screen: "room", title: "Room", about: "Online with a friend, through a room on Cloudflare. (More players and spectators later.)", color: "#f8a54b" },
];

const SCREENS = {
  main: { title: "Wizard Duel", subtitle: "Choose how to play", hint: "Click a mode, or press 1–4." },
  cpu: { title: "vs CPU", subtitle: "Choose your wizard: the CPU plays the other.", hint: "Click a wizard, or press 1 or 2.    Esc: back" },
  training: {
    title: "Training",
    subtitle: "Player 1 (WASD, J K L U, Left Shift) plays the wizard you choose,\nplayer 2 (arrows, . / ' Enter ;) plays the other.",
    hint: "Click a wizard, or press 1 or 2.    Esc: back",
  },
  quick: online("quick"),
  room: online("room"),
};

function online(mode) {
  const { title, via, about } = ONLINE_MODES[mode];
  return {
    title: `${title}  ·  ${via}`,
    subtitle: `${about}\nHost and tell your friend the code, or type your friend's code at the top.`,
    hint: "H: host    ·    Esc: back (leaves the online game)",
  };
}

export function createMenu(wizards, { onMode, onWizard, onHost }) {
  const ui = AdvancedDynamicTexture.CreateFullscreenUI("menu");
  ui.idealWidth = 1280; // sizes below are for a 1280-px-wide window; GUI scales them

  // A dark veil over the whole screen, holding everything else.
  const veil = new Rectangle("menuVeil");
  veil.background = "#05060ccc";
  veil.thickness = 0;
  ui.addControl(veil);

  const column = new StackPanel("menuColumn"); // stacks its children top to bottom
  veil.addControl(column);
  const title = text("", 52, 80);
  title.name = "menuTitle";
  const subtitle = text("", 19, 64);
  column.addControl(title);
  column.addControl(subtitle);

  // The four modes, two rows of two.
  const modes = new StackPanel("modes");
  column.addControl(modes);
  for (let row = 0; row < 2; row++) {
    const line = new StackPanel(`modesRow${row}`);
    line.isVertical = false; // side by side
    line.height = "150px";
    modes.addControl(line);
    MODES.slice(row * 2, row * 2 + 2).forEach((mode, i) => line.addControl(modeButton(mode, row * 2 + i, () => onMode(mode.screen))));
  }

  // The two wizards (vs CPU, Training, and online once your friend is here and you host).
  const wizardRow = new StackPanel("wizardRow");
  wizardRow.isVertical = false;
  wizardRow.height = "220px";
  column.addControl(wizardRow);
  wizards.forEach((data, i) => wizardRow.addControl(wizardButton(data, i, () => onWizard(i))));

  // Online screens: host, and the news (the code, "connected", the ping...).
  const host = Button.CreateSimpleButton("hostOnline", "Host  (H)");
  host.width = "320px";
  host.height = "48px";
  host.paddingTop = "8px";
  host.color = "#ffd75e";
  host.cornerRadius = 8;
  host.background = "#000000aa";
  host.fontSize = 20;
  host.onPointerUpObservable.add(onHost);
  column.addControl(host);
  const news = text("", 18, 64, "#ffd75e"); // two lines at most
  news.name = "onlineNews";
  column.addControl(news);

  const hint = text("", 17, 40, "#ffffffaa");
  column.addControl(hint);

  let screen = "main";
  let picking = false; // online: connected as the host, so the wizards can be picked
  let hosting = false; // online: hosting or joined already (no Host button)

  function layout() {
    const online = screen === "quick" || screen === "room";
    title.text = SCREENS[screen].title;
    subtitle.text = SCREENS[screen].subtitle;
    hint.text = SCREENS[screen].hint;
    modes.isVisible = screen === "main";
    wizardRow.isVisible = screen === "cpu" || screen === "training" || (online && picking);
    host.isVisible = online && !hosting;
    news.isVisible = online;
  }
  layout();

  return {
    get visible() {
      return veil.isVisible;
    },
    get screen() {
      return screen;
    },
    // Show the menu at this screen.
    open(newScreen) {
      screen = newScreen;
      veil.isVisible = true;
      layout();
    },
    hide() {
      veil.isVisible = false;
    },
    // The online screens' state, from net/online.js (set every frame by main.js).
    setOnline(value, state) {
      news.text = value;
      if (state.picking === picking && state.hosting === hosting) return;
      picking = state.picking;
      hosting = state.hosting;
      layout();
    },
  };
}

// A mode: its name, a line about it, and the key that picks it, framed in its colour.
function modeButton(mode, index, choose) {
  const button = card(`mode${index}`, "440px", mode.color, choose);
  const lines = new StackPanel(`mode${index}Lines`);
  lines.addControl(text(mode.title, 30, 44, mode.color));
  const about = text(mode.about, 16, 46);
  about.textWrapping = true;
  about.width = "410px";
  lines.addControl(about);
  lines.addControl(text(`press ${index + 1}`, 15, 24, "#ffffffaa"));
  button.addControl(lines);
  return button;
}

// A big button: the wizard's name, his special, and the key that picks him, framed in his colour.
function wizardButton(data, index, choose) {
  const button = card(`choose${data.name}`, "360px", data.colors.ui, choose);
  const lines = new StackPanel(`${data.name}Lines`);
  lines.addControl(text(data.fullName, 34, 56));
  lines.addControl(text(`Special: ${SPECIALS[data.special].name}`, 20, 34));
  lines.addControl(text(`press ${index + 1}`, 18, 34, "#ffffffaa"));
  button.addControl(lines);
  return button;
}

// An empty framed button that lights up under the mouse (on a phone you just tap).
function card(name, width, color, onClick) {
  const button = Button.CreateSimpleButton(name, "");
  button.width = width;
  button.paddingLeft = button.paddingRight = "16px"; // a gap between neighbours
  button.paddingTop = button.paddingBottom = "8px";
  button.thickness = 3;
  button.cornerRadius = 12;
  button.color = color; // a button's `color` is its border (and text) colour
  button.background = "#000000aa";
  button.textBlock.isVisible = false; // we lay out our own lines
  button.onPointerUpObservable.add(onClick);
  button.pointerEnterAnimation = () => (button.background = "#ffffff22");
  button.pointerOutAnimation = () => (button.background = "#000000aa");
  return button;
}

function text(value, size, height, color = "white") {
  const block = new TextBlock(undefined, value);
  block.fontSize = size;
  block.height = `${height}px`;
  block.color = color;
  block.outlineWidth = 3;
  block.outlineColor = "black";
  block.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  return block;
}
