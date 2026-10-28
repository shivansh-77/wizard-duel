import { CODE_LETTERS, ONLINE_MODES } from "../data/online.js";
import * as cloudflare from "./cloudflare.js";
import { createLockstep } from "./lockstep.js";
import * as peer from "./peer.js";

// The online session: which mode (Quick duel or Room), the link (net/peer.js or net/cloudflare.js:
// the same functions and events, so this file doesn't care which), whether we host or joined, and the
// online duel's lockstep (net/lockstep.js). main.js asks it to host, join, leave or start a duel, and
// reads `news` (for the menu's online screen) and `status` (for the HUD) every frame; it tells main.js:
//   onStart(you): an online duel starts (or restarts), and you play wizard `you`;
//   onLeft(): the friend left during a duel (main.js lets the CPU take over his wizard).
// The host picks the wizards: he plays the one he picks, his friend the other.

const LINKS = { quick: peer, room: cloudflare };
const MAX_TRIES = 5; // codes to try when the first is taken

// Which mode a code belongs to, by its length (4 = Quick duel, 5 = Room), or null.
export function modeOfCode(code) {
  return Object.keys(ONLINE_MODES).find((mode) => ONLINE_MODES[mode].codeLength === code.length) ?? null;
}

function makeCode(length) {
  return Array.from({ length }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");
}

export function createOnline({ onStart, onLeft }) {
  let mode = null; // "quick" or "room" while hosting or joined
  let link = null;
  let linkId = 0; // events from an older link (after leaving) are ignored
  let role = null; // "host" or "guest"
  let tries = 0;
  let connected = false;
  let round = 0; // which online duel: each start or restart is a new round
  let lockstep = null; // while an online duel runs
  let ping = null; // the latest round trip, in ms (null until the first answer)
  let pings = { count: 0, sum: 0, worst: 0 }; // this duel's, for the HUD's comparison line
  let route = ""; // which way the data goes (from the link)
  let news = "";

  function say(text) {
    news = text;
  }

  function open(code) {
    const id = ++linkId;
    const on = (event) => {
      if (id === linkId) handle(event);
    };
    link = role === "host" ? LINKS[mode].hostGame(code, on) : LINKS[mode].joinGame(code, on);
  }

  // Back to no session at all (leaving, or the host left a guest).
  function reset() {
    linkId++;
    link?.close();
    link = null;
    mode = null;
    role = null;
    connected = false;
    lockstep = null;
    ping = null;
    route = "";
  }

  // Everything the link reports.
  function handle(event) {
    const title = ONLINE_MODES[mode].title;
    if (event.type === "code") {
      // Two ways in: type the code (works everywhere, also on itch.io), or open the link (not on
      // itch.io: there the game runs in a frame the link can't reach).
      const invite = `${location.origin}${location.pathname}?join=${event.code}`;
      say(`Your code: ${event.code}   (your friend opens ${title} and types it)\nor opens: ${invite}`);
      navigator.clipboard?.writeText(event.code).then(() => say(`${news}  (code copied)`), () => {});
    }
    if (event.type === "taken") {
      // Someone already uses this code (very rare): try another.
      link.close();
      if (++tries > MAX_TRIES) return say("Couldn't get a free code: try again.");
      open(makeCode(ONLINE_MODES[mode].codeLength));
    }
    if (event.type === "connected") {
      connected = true;
      say(role === "host" ? "Connected! Pick your wizard (1 or 2): the duel starts for both of you." : "Connected! Your friend (the host) is picking the wizards…");
    }
    if (event.type === "route") route = event.text;
    if (event.type === "ping") {
      ping = event.ms;
      if (lockstep) {
        pings.count++;
        pings.sum += ping;
        pings.worst = Math.max(pings.worst, ping);
      } else {
        say(`Connected, ping ${ping} ms: ${role === "host" ? "pick your wizard to start" : "the host is picking"}`);
      }
    }
    if (event.type === "closed") {
      const inDuel = lockstep !== null;
      connected = false;
      lockstep = null;
      if (role === "host") say(inDuel ? "Your friend left: the CPU takes over." : "Your friend left. Waiting for another friend with the same code…");
      else {
        reset(); // the host is gone: nothing left to wait for
        say(inDuel ? "The host left: the CPU takes over." : "The host left.");
      }
      if (inDuel) onLeft();
    }
    if (event.type === "error") {
      if (!connected) reset(); // nothing to keep (a wrong code, no relay...): free to try again
      say(event.text);
    }
    if (event.type === "message") receive(event.message);
  }

  function receive(message) {
    if (message.type === "start") begin(message.round, 1 - message.hostPlays, message.delay); // the host plays the other one
    else if (lockstep) lockstep.receive(message); // inputs and checksums
  }

  // A new online duel (round), both sides: a fresh lockstep, then main.js resets the duel.
  function begin(newRound, you, delay) {
    round = newRound;
    pings = { count: 0, sum: 0, worst: 0 };
    lockstep = createLockstep({
      send: (message) => link.send(message),
      you,
      round,
      delay,
      onDesync: (step) => say(`Out of sync at step ${step}: the two duels differ!`),
    });
    onStart(you);
  }

  return {
    get news() {
      return news;
    },
    get mode() {
      return mode;
    },
    get lockstep() {
      return lockstep;
    },
    get isHost() {
      return role === "host";
    },
    get connected() {
      return connected;
    },
    // One line for the HUD during an online duel, to compare the two modes:
    // "Room · Cloudflare (room in BOM, you enter at DEL) · ping 48 ms (avg 45, worst 80) · ...".
    get status() {
      if (!lockstep) return "";
      const { title, via } = ONLINE_MODES[mode];
      const ms = (steps) => Math.round((steps * 1000) / 60);
      const parts = [`${title} · ${via}${route ? ` (${route})` : ""}`];
      if (ping !== null) parts.push(`ping ${ping} ms` + (pings.count > 0 ? ` (avg ${Math.round(pings.sum / pings.count)}, worst ${pings.worst})` : ""));
      parts.push(`input delay ${ms(lockstep.delay)} ms`);
      parts.push(`freezes ${lockstep.freezes} (${(lockstep.frozenMs / 1000).toFixed(1)} s)`);
      return parts.join("  ·  ");
    },
    // Host a duel in `newMode` ("quick" or "room"): a fresh code, then wait for a friend.
    host(newMode) {
      if (link) return; // already hosting or joined
      mode = newMode;
      role = "host";
      tries = 0;
      open(makeCode(ONLINE_MODES[mode].codeLength));
      say(mode === "quick" ? "Hosting: asking the PeerServer for a game code…" : "Hosting: opening a room on Cloudflare…");
    },
    // Join a friend's game. The code's length says which mode it belongs to.
    join(code) {
      if (link) {
        say(role === "host" ? "You're hosting already: go back (Esc) to join a friend instead." : "Already joining a game.");
        return;
      }
      mode = modeOfCode(code);
      if (!mode) return say("A code has 4 characters (Quick duel) or 5 (Room).");
      role = "guest";
      open(code);
      say(`Joining ${ONLINE_MODES[mode].title} ${code}…`);
    },
    // Leave the online session (back to the menu): says "bye" to the friend.
    leave() {
      reset();
      say("");
    },
    // Host only: start (or restart) the online duel. You play wizard `hostPlays`, your friend the other.
    // The input delay is chosen from the ping now and sent along, so both computers use the same one.
    // The "start" message travels on the same ordered channel as the inputs, so your friend's game
    // switches to the new round exactly between the old round's inputs and the new one's.
    start(hostPlays) {
      round++;
      const delay = delayFor(ping);
      link.send({ type: "start", round, hostPlays, delay });
      begin(round, hostPlays, delay);
    },
  };
}

// The input delay (in 1/60 s steps) that suits a connection: long enough for a key press to reach the
// friend (half the round trip) plus a margin for the ping's ups and downs, so the duel rarely has to
// wait. At least 3 steps (50 ms: barely felt), at most 12 (200 ms: sluggish, but smooth).
// Ping 30 ms → 3 steps, 100 ms → 5, 250 ms (through a far-away relay) → 9.
export function delayFor(ping) {
  if (ping === null) return 4; // no measurement yet
  return Math.min(12, Math.max(3, Math.ceil((ping / 2 + 25) / (1000 / 60))));
}
