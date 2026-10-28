import { Peer } from "peerjs";

// Connecting two browsers with PeerJS: the first piece of online play.
//
// How it works:
//   WebRTC lets two browsers send data straight to each other (peer to peer), no game server in the
//   middle. But to find each other they need a go-between first: a "signalling server". PeerJS gives
//   us one for free (its public PeerServer, 0.peerjs.com) and hides WebRTC's paperwork.
//   1. The host makes a Peer with an id (our "game code"). PeerJS registers it on the PeerServer.
//   2. The friend makes a Peer too (no id needed: the server gives one) and calls
//      peer.connect(host's id). The PeerServer passes the two browsers each other's network details.
//   3. WebRTC opens a "data channel" straight between them: a DataConnection. From then on the
//      PeerServer isn't involved; messages go browser to browser.
//   If the two can't reach each other directly (some networks hide many users behind one address),
//   a TURN relay passes the data along instead: that's what we'll set up with Cloudflare later.
//
// Messages here are small objects ({ type: "ping", ... }), sent as JSON. Every second each side pings
// the other, and the answer tells how long a round trip takes ("ping", in milliseconds).

const PREFIX = "wizard-duel-"; // ids on the public PeerServer are shared by everyone: ours start with this
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I, which look alike
const PING_EVERY = 1000; // milliseconds
// Milliseconds without a word from the friend: he's gone (crashed, lost his Wi-Fi...). Not shorter: a
// page that's still loading (models, shaders) can be too busy to answer for several seconds.
const SILENCE = 10000;

// Host a game: makes a game code and waits for a friend to connect with it.
// `on` gets events: { type: "code", code }, { type: "connected" }, { type: "ping", ms },
// { type: "message", message }, { type: "closed" }, { type: "error", text }.
// Returns { send(message), close() }.
export function hostGame(on) {
  const code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");
  const peer = new Peer(PREFIX + code);
  const link = createLink(peer, on);
  peer.on("open", () => on({ type: "code", code })); // registered on the PeerServer: tell the friend the code
  peer.on("connection", (connection) => link.use(connection)); // a friend connected
  return link;
}

// Join a friend's game by its code.
export function joinGame(code, on) {
  const peer = new Peer(); // the PeerServer gives us an id
  const link = createLink(peer, on);
  peer.on("open", () => {
    // reliable: true = every message arrives, in order (like a phone call that repeats what got lost).
    // Fine for these few messages; the duel's inputs, sent 60 times a second, will use reliable: false.
    link.use(peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: "json" }));
  });
  return link;
}

// What both sides share: one DataConnection, pings, and noticing when the friend is gone. WebRTC can
// take half a minute to report a vanished peer, so we don't wait for it: a closing tab says "bye",
// and SILENCE ms without hearing anything (not even a pong) counts as gone too (a "heartbeat timeout").
function createLink(peer, on) {
  let connection = null;
  let timer = null;
  let lastHeard = 0; // performance.now() when the friend last sent anything

  // The friend is gone: stop pinging, forget the connection, say so (once).
  function lost() {
    if (!connection) return;
    clearInterval(timer);
    connection.close();
    connection = null;
    on({ type: "closed" });
  }
  // Closing or reloading the tab: tell the friend straight away.
  window.addEventListener("pagehide", () => send({ type: "bye" }));

  peer.on("error", (error) => {
    const text = error.type === "peer-unavailable" ? "No game with that code (is the host still waiting?)" : `${error.type}: ${error.message}`;
    on({ type: "error", text });
  });

  function use(newConnection) {
    if (connection) {
      newConnection.close(); // a 2-player game: a third visitor is turned away
      return;
    }
    connection = newConnection;
    connection.on("open", () => {
      lastHeard = performance.now();
      on({ type: "connected" });
      timer = setInterval(() => {
        if (performance.now() - lastHeard > SILENCE) lost();
        else send({ type: "ping", sent: performance.now() });
      }, PING_EVERY);
    });
    connection.on("data", (message) => {
      lastHeard = performance.now();
      if (message.type === "ping") send({ type: "pong", sent: message.sent }); // send it straight back
      else if (message.type === "pong") on({ type: "ping", ms: Math.round(performance.now() - message.sent) });
      else if (message.type === "bye") lost();
      else on({ type: "message", message });
    });
    connection.on("close", lost); // when WebRTC does notice
  }

  function send(message) {
    if (connection && connection.open) connection.send(message);
  }

  return {
    use,
    send,
    close() {
      clearInterval(timer);
      peer.destroy(); // closes the connection and leaves the PeerServer
    },
  };
}
