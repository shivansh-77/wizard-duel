// What happens when a wizard gets hurt: shared by bolts, specials and the clash.

// A blow that lands: a shove along `push` (a direction of length 1) at `knockback` m/s, a stun, a
// hit-stop for everyone, and whatever he was doing is interrupted (a cast, a beam or a special
// winding up, a flowing beam). Locked in a clash, he isn't moved or interrupted. Then the damage.
export function strike(duel, wizard, { damage: amount, push, knockback, stun, stopSteps }) {
  if (!duel.clash) {
    wizard.vx += push.x * knockback;
    wizard.vz += push.z * knockback;
    wizard.castTimer = 0;
    wizard.beamTimer = 0;
    wizard.specialTimer = 0;
    if (wizard.beaming) {
      stopBeam(wizard);
      duel.events.push({ type: "beamEnd", wizard: wizard.index });
    }
  }
  wizard.stun = Math.max(wizard.stun, stun);
  duel.hitStop = Math.max(duel.hitStop, stopSteps);
  damage(duel, wizard, amount);
}

// Takes health away. At 0 he's knocked out, every beam stops, and the duel is over.
export function damage(duel, wizard, amount) {
  wizard.health = Math.max(0, wizard.health - amount);
  if (wizard.health > 0 || wizard.down) return;
  wizard.down = true;
  duel.phase = "over";
  duel.winner = 1 - wizard.index;
  duel.clash = null;
  for (const each of duel.wizards) stopBeam(each);
  duel.events.push({ type: "ko", wizard: wizard.index });
}

export function stopBeam(wizard) {
  wizard.beaming = false;
  wizard.beamTime = 0;
  wizard.beamDir = null;
  wizard.beamStart = null;
  wizard.beamEnd = null;
  wizard.beamContact = null;
}
