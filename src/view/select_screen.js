import { AdvancedDynamicTexture, Button, Control, Rectangle, StackPanel, TextBlock } from "@babylonjs/gui";
import { SPECIALS } from "../data/spells.js";

// The start screen: choose which wizard you play. Two big buttons over the arena (Babylon GUI, its own
// full-screen layer on top of the HUD). Click one, or press 1 / 2 (main.js passes those keys in).
// onChoose(index) gets 0 for the first wizard in `wizards` (Dumbledore), 1 for the second.
// Below them, online play (net/peer.js): a button to host (onHost), and a line for its news
// (setOnline: the game code, "connected", the ping).
export function createSelectScreen(wizards, onChoose, onHost) {
  const ui = AdvancedDynamicTexture.CreateFullscreenUI("select");
  ui.idealWidth = 1280; // sizes below are for a 1280-px-wide window; GUI scales them

  // A dark veil over the whole screen, holding everything else.
  const veil = new Rectangle("selectVeil");
  veil.background = "#05060ccc";
  veil.thickness = 0;
  ui.addControl(veil);

  const column = new StackPanel("selectColumn"); // stacks its children top to bottom
  veil.addControl(column);
  column.addControl(text("Choose your wizard", 52, 90));

  const row = new StackPanel("selectRow");
  row.isVertical = false; // side by side
  row.height = "230px";
  column.addControl(row);
  wizards.forEach((data, i) => row.addControl(wizardButton(data, i, () => onChoose(i))));

  column.addControl(text("Click one, or press 1 or 2.   Esc comes back here.", 20, 50));
  column.addControl(text("The CPU plays the other wizard  (C: a second player on the arrow keys instead).", 17, 34));

  const host = Button.CreateSimpleButton("hostOnline", "Host an online duel  (H)");
  host.width = "320px";
  host.height = "44px";
  host.paddingTop = "10px";
  host.color = "#ffd75e";
  host.cornerRadius = 8;
  host.background = "#000000aa";
  host.fontSize = 18;
  host.onPointerUpObservable.add(onHost);
  column.addControl(host);
  const online = text("", 18, 64, "#ffd75e"); // the online news, two lines at most
  online.name = "onlineNews";
  column.addControl(online);

  return {
    get visible() {
      return veil.isVisible;
    },
    setOnline(value) {
      online.text = value;
    },
    show() {
      veil.isVisible = true;
    },
    hide() {
      veil.isVisible = false;
    },
  };
}

// A big button: the wizard's name, his special, and the key that picks him, framed in his colour.
function wizardButton(data, index, choose) {
  const button = Button.CreateSimpleButton(`choose${data.name}`, "");
  button.width = "360px";
  button.height = "200px";
  button.paddingLeft = button.paddingRight = "20px"; // a gap between the two buttons
  button.thickness = 3;
  button.cornerRadius = 12;
  button.color = data.colors.ui; // a button's `color` is its border (and text) colour
  button.background = "#000000aa";
  button.textBlock.isVisible = false; // we lay out our own lines below
  button.onPointerUpObservable.add(choose);
  // Hovering lights the frame up (with a mouse; on a phone you just tap).
  button.pointerEnterAnimation = () => (button.background = "#ffffff22");
  button.pointerOutAnimation = () => (button.background = "#000000aa");

  const lines = new StackPanel(`${data.name}Lines`);
  lines.addControl(text(data.fullName, 34, 56));
  lines.addControl(text(`Special: ${SPECIALS[data.special].name}`, 20, 34));
  lines.addControl(text(`press ${index + 1}`, 18, 34, "#ffffffaa"));
  button.addControl(lines);
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
