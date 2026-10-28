import { AdvancedDynamicTexture, Control, Rectangle, TextBlock } from "@babylonjs/gui";
import { CLASH, SPECIALS } from "../data/spells.js";

const LEFT = Control.HORIZONTAL_ALIGNMENT_LEFT;
const RIGHT = Control.HORIZONTAL_ALIGNMENT_RIGHT;
const TOP = Control.VERTICAL_ALIGNMENT_TOP;
const CENTER = Control.VERTICAL_ALIGNMENT_CENTER;
const BOTTOM = Control.VERTICAL_ALIGNMENT_BOTTOM;

// The keys line by line: yours, player 2's in Training (same keyboard), and the other keys.
function help(yours, theirs, training) {
  const lines = [`${training ? "Player 1" : "You"} (${yours.name}):  WASD glide  ·  J cast  ·  K apparate  ·  L Protego (hold)  ·  U beam  ·  Left Shift ${SPECIALS[yours.special].name}`];
  if (training) lines.push(`Player 2 (${theirs.name}):  arrows glide  ·  . cast  ·  / apparate  ·  ' Protego (hold)  ·  Enter beam  ·  ; ${SPECIALS[theirs.special].name}`);
  lines.push("Esc  menu  ·  M  sound  ·  R  restart  ·  V  camera (duel / behind you)  ·  F  Fiendfyre's look");
  return lines.join("\n");
}

// The 2D layer drawn over the 3D scene: health bars (yours on the left), the winner banner, who plays
// the other wizard, and the controls. Babylon GUI draws it into an AdvancedDynamicTexture that covers
// the whole screen.
export function createHud() {
  const ui = AdvancedDynamicTexture.CreateFullscreenUI("hud");
  ui.idealWidth = 1280; // sizes below are for a 1280-px-wide window; GUI scales them to the real width

  const bars = [createHealthBar(ui, LEFT), createHealthBar(ui, RIGHT)]; // yours, the other's
  const status = createText(ui, "", { size: 18, height: 30, align: TOP, top: 88, outline: 3 }); // below the bars
  const banner = createText(ui, "", { size: 64, height: 90, top: -50, outline: 8 });
  const prompt = createText(ui, "Press R to duel again  ·  Esc for the menu", { size: 26, height: 40, top: 20, outline: 5 });
  const clashTitle = createText(ui, "Priori Incantatem!", { size: 46, height: 64, align: TOP, top: 120, color: CLASH.color, outline: 7 });
  const clashHint = createText(ui, "Mash cast to push the light at him!", { size: 22, height: 34, align: TOP, top: 178, outline: 4 });
  const controls = createText(ui, "", { size: 15, height: 70, align: BOTTOM, top: -14, outline: 3 });
  // Online: the connection, to compare Quick duel and Room (net/online.js `status`), or its news.
  const net = createText(ui, "", { size: 16, height: 26, align: BOTTOM, top: -88, color: "#ffd75e", outline: 3 });

  return {
    // Copies the duel onto the HUD every frame: cheap, and it can never get out of date. `you` is
    // the index of your wizard in duel.wizards; `opponent` who drives the other ("cpu", "player2" in
    // Training, or "friend" online); `online`: the connection line (empty offline); `waiting`: an
    // online duel is held up, waiting for the friend's input.
    sync(duel, { you, opponent, muted, look, online, waiting }) {
      const yours = duel.wizards[you];
      const theirs = duel.wizards[1 - you];
      bars[0].show(yours, " (you)");
      bars[1].show(theirs, "");
      controls.text = help(yours.data, theirs.data, opponent === "player2");
      clashTitle.isVisible = duel.clash !== null;
      clashHint.isVisible = duel.clash !== null;
      const over = duel.phase === "over";
      banner.isVisible = over;
      prompt.isVisible = over;
      if (over) banner.text = `${duel.wizards[duel.winner].data.name} wins!`;
      const labels = { cpu: "CPU", player2: "player 2 (arrows)", friend: "your friend, online" };
      const parts = [`${theirs.data.name}: ${labels[opponent]}`, `Fiendfyre: ${look}`];
      if (muted) parts.push("sound off");
      if (waiting) parts.push("waiting for your friend…");
      status.text = parts.join("    ·    ");
      net.text = online;
    },
  };
}

// A name and a health bar in a top corner, and under it a line saying when his big moves are ready.
// show(wizard, label) copies a wizard's name, colour, health and cooldowns onto them (either wizard
// can sit on either side, so they're set every frame).
function createHealthBar(ui, side) {
  const key = side === LEFT ? "left" : "right";
  const panel = new Rectangle(`${key}Panel`); // an invisible box that holds the name and the bar
  panel.width = "440px";
  panel.height = "64px";
  panel.thickness = 0; // no border
  panel.horizontalAlignment = side;
  panel.verticalAlignment = TOP;
  panel.left = side === LEFT ? "24px" : "-24px";
  panel.top = "16px";
  ui.addControl(panel);

  const name = new TextBlock(`${key}Name`, "");
  name.height = "30px";
  name.fontSize = 24;
  name.color = "white";
  name.verticalAlignment = TOP;
  name.textHorizontalAlignment = side;
  panel.addControl(name);

  const back = new Rectangle(`${key}BarBack`); // the empty bar
  back.height = "22px";
  back.verticalAlignment = BOTTOM;
  back.background = "#00000099";
  back.color = "#ffffff66"; // a Rectangle's `color` is its border colour
  back.thickness = 2;
  back.cornerRadius = 4;
  panel.addControl(back);

  const fill = new Rectangle(`${key}BarFill`); // the health left, inside the empty bar
  fill.horizontalAlignment = side; // anchored at the screen's edge, so it shrinks toward it
  fill.thickness = 0;
  back.addControl(fill);

  const ready = new TextBlock(`${key}Ready`, "");
  ready.width = "440px";
  ready.height = "24px";
  ready.fontSize = 16;
  ready.color = "white";
  ready.outlineWidth = 3;
  ready.outlineColor = "black";
  ready.horizontalAlignment = side;
  ready.verticalAlignment = TOP;
  ready.textHorizontalAlignment = side;
  ready.left = panel.left;
  ready.top = "84px"; // just below the bar
  ui.addControl(ready);

  // "ready", or the seconds left, rounded up.
  const countdown = (seconds) => (seconds > 0 ? `${Math.ceil(seconds)}s` : "ready");

  return {
    show(wizard, label) {
      const data = wizard.data;
      name.text = data.name + label;
      fill.background = data.colors.ui;
      fill.width = `${Math.round((wizard.health / data.maxHealth) * 100)}%`;
      ready.text = `Beam ${countdown(wizard.beamCooldown)}    ·    ${SPECIALS[data.special].name} ${countdown(wizard.specialCooldown)}`;
    },
  };
}

// A line (or lines) of white text, centred across the screen. Sizes are in pixels.
function createText(ui, text, { size, height, align = CENTER, top = 0, color = "white", outline = 0 }) {
  const block = new TextBlock(undefined, text);
  block.fontSize = size;
  block.height = `${height}px`;
  block.verticalAlignment = align;
  block.top = `${top}px`;
  block.color = color;
  if (outline > 0) {
    block.outlineWidth = outline; // a dark outline keeps text readable over the bright platform
    block.outlineColor = "black";
  }
  ui.addControl(block);
  return block;
}
