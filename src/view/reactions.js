import { CLASH, PROTEGO } from "../data/spells.js";
import { BOLT_HEIGHT } from "./bolts.js";
import { showCast, showHit, showShieldStop } from "./wizard.js";

// Turns the rules' events into what you see and hear: sparks, flashes, camera shake, the picture's
// jolt (post.kick), sounds. Everything about how a hit *feels* lives here, so it's easy to tune.
export function createReactions({ effects, camera, post, wandGlows, wizardViews, sounds }) {
  // Reacts to one frame's events. Sounds are gathered first so each kind plays once per frame: two
  // copies starting together add up and can clip (crackle). A bigger sound also stands in for the
  // smaller ones that come with it.
  return function react(events) {
    const toPlay = new Set();
    for (const event of events) {
      const view = wizardViews[event.wizard];
      const sparks = (hex, count) => effects.sparks(event.x, BOLT_HEIGHT, event.z, hex, count);
      switch (event.type) {
        case "cast":
          showCast(view);
          wandGlows.flash(event.wizard);
          toPlay.add("cast");
          break;
        case "hit": // a bolt, a whip or a serpent (event.color says which)
          showHit(view);
          sparks(event.color, 50);
          camera.shake(0.15);
          post.kick(0.35);
          toPlay.add("hit");
          break;
        case "block":
          showShieldStop(view);
          sparks(PROTEGO.color, 30);
          toPlay.add("block");
          break;
        case "reflect":
          showShieldStop(view);
          sparks(PROTEGO.color, 60);
          camera.shake(0.08);
          post.kick(0.2);
          toPlay.add("reflect");
          break;
        case "fizzle": // a bolt swallowed by a beam or a serpent
          sparks(event.color, 20);
          toPlay.add("block");
          break;
        case "shield":
          toPlay.add("shield");
          break;
        case "vanish":
          effects.puff(event.x, event.z);
          toPlay.add("apparate");
          break;
        case "appear":
          effects.puff(event.x, event.z);
          break;
        case "beam":
          camera.shake(0.05);
          toPlay.add("beam");
          break;
        case "clash":
          sparks(CLASH.color, 80);
          camera.shake(0.25);
          post.kick(0.4);
          toPlay.add("clash");
          break;
        case "push": // one press while mashing
          sparks(CLASH.color, 8);
          camera.shake(0.03);
          toPlay.add("push");
          break;
        case "clashEnd":
          sparks(CLASH.color, 150);
          camera.shake(0.6);
          post.kick(1);
          if (event.loser !== null) showHit(wizardViews[event.loser]);
          toPlay.add("burst");
          break;
        case "whip":
          camera.shake(0.06);
          toPlay.add("whip");
          break;
        case "serpent":
          camera.shake(0.08);
          toPlay.add("serpent");
          break;
        case "fireOut": // a serpent put out
          sparks(event.color, 40);
          effects.puff(event.x, event.z);
          toPlay.add("fireOut");
          break;
        case "ko":
          camera.shake(0.45);
          post.kick(0.8);
          toPlay.add("ko");
          break;
      }
    }
    if (toPlay.has("clash")) toPlay.delete("beam");
    if (toPlay.has("burst")) {
      toPlay.delete("hit");
      toPlay.delete("ko");
    }
    for (const name of toPlay) sounds.play(name);
  };
}
