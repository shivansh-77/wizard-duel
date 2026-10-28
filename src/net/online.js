import { createLockstep } from "./lockstep.js";
import { hostGame, joinGame } from "./peer.js";

// The online session: the PeerJS link (net/peer.js), whether we host or joined, and the online duel's
// lockstep (net/lockstep.js). main.js asks it to host, join or start a duel; it tells main.js:
//   onNews(text): what to show on the start screen and in the HUD;
//   onStart(you): an online duel starts (or restarts), and you play wizard `you`;
//   onLeft(): the friend left (main.js lets the CPU take over his wizard).
// The host picks the wizards: he plays the one he picks, his friend the other.
export function createOnline({ onNews, onStart, onLeft }) {
  let link = null;
  let role = null; // "host" or "guest"
  let connected = false;
  let round = 0; // which online duel: each start or restart is a new round
  let lockstep = null; // while an online duel runs
  let ping = null; // the latest round trip, in ms (null until the first answer)
  let news = "";

  function say(text) {
    news = text;
    onNews(text);
  }

  // Everything net/peer.js reports.
  function handle(event) {
    if (event.type === "code") {
      // Two ways in: type the code in "Join a friend's game" (works everywhere, also on itch.io), or open
      // the link (not on itch.io: there the game runs in a frame the link can't reach).
      const invite = `${location.origin}${location.pathname}?join=${event.code}`;
      say(`Your game code: ${event.code}  (your friend types it in "Join a friend's game")\nor opens: ${invite}`);
      navigator.clipboard?.writeText(event.code).then(() => onNews(`${news}  (code copied)`), () => {});
    }
    if (event.type === "connected") {
      connected = true;
      say(role === "host" ? "Connected! Pick your wizard (1 or 2): the duel starts for both of you." : "Connected! Your friend (the host) is picking the wizards…");
    }
    if (event.type === "ping") {
      ping = event.ms;
      const waitingFor = role === "host" ? "pick your wizard to start" : "the host is picking";
      const delayMs = lockstep ? Math.round((lockstep.delay * 1000) / 60) : 0;
      say(lockstep ? `Online duel, ping ${ping} ms, input delay ${delayMs} ms` : `Connected, ping ${ping} ms: ${waitingFor}`);
    }
    if (event.type === "closed") {
      connected = false;
      lockstep = null;
      say("Your friend left: the CPU takes over.");
      onLeft();
    }
    if (event.type === "error") say(event.text);
    if (event.type === "message") receive(event.message);
  }

  function receive(message) {
    if (message.type === "start") begin(message.round, 1 - message.hostPlays, message.delay); // the host plays the other one
    else if (lockstep) lockstep.receive(message); // inputs and checksums
  }

  // A new online duel (round), both sides: a fresh lockstep, then main.js resets the duel.
  function begin(newRound, you, delay) {
    round = newRound;
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
    get lockstep() {
      return lockstep;
    },
    get isHost() {
      return role === "host";
    },
    get connected() {
      return connected;
    },
    host() {
      if (link) return; // already hosting or joined
      role = "host";
      link = hostGame(handle);
      say("Hosting: asking the PeerServer for a game code…");
    },
    join(code) {
      if (link) {
        say(role === "host" ? "You're hosting already: reload the page to join a friend instead." : "Already joining a game.");
        return;
      }
      role = "guest";
      link = joinGame(code, handle);
      say(`Joining game ${code.toUpperCase()}…`);
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
