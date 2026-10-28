import { Peer } from "peerjs";
import { createHeartbeat } from "./heartbeat.js";

// Quick duel's link: two browsers connected straight to each other with PeerJS.
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
//   a TURN relay passes the data along instead (PeerJS's free ones are in Europe and the US). Once
//   connected, the link reports which way the data goes: "direct" or "through a TURN relay".
//
// net/cloudflare.js does the same job through a Cloudflare room, with the same functions and events,
// so net/online.js can use either.

const PREFIX = "wizard-duel-"; // ids on the public PeerServer are shared by everyone: ours start with this

// Host a game under `code`, and wait for a friend to connect with it.
// `on` gets events: { type: "code", code } (registered: tell your friend), { type: "taken" } (someone
// already uses this code: try another), { type: "connected" }, { type: "route", text },
// { type: "ping", ms }, { type: "message", message }, { type: "closed" }, { type: "error", text }.
// Returns { send(message), close() }.
export function hostGame(code, on) {
  const peer = new Peer(PREFIX + code);
  const link = createLink(peer, on);
  peer.on("open", () => on({ type: "code", code })); // registered on the PeerServer
  peer.on("connection", (connection) => link.use(connection)); // a friend connected
  return link;
}

// Join a friend's game by its code.
export function joinGame(code, on) {
  const peer = new Peer(); // the PeerServer gives us an id
  const link = createLink(peer, on);
  peer.on("open", () => {
    // reliable: true = every message arrives, in order (like a phone call that repeats what got lost).
    link.use(peer.connect(PREFIX + code, { reliable: true, serialization: "json" }));
  });
  return link;
}

// What both sides share: one DataConnection and its heartbeat (net/heartbeat.js: pings, "bye", noticing
// silence). WebRTC can take half a minute to report a vanished peer, so we don't wait for it.
function createLink(peer, on) {
  let connection = null;

  // The friend is gone: forget the connection, say so (once). It's forgotten BEFORE close(), because
  // close() fires the connection's "close" event, which calls lost() again.
  function lost() {
    if (!connection) return;
    const old = connection;
    connection = null;
    heartbeat.stop();
    old.close();
    on({ type: "closed" });
  }
  function send(message) {
    if (connection && connection.open) connection.send(message);
  }
  const heartbeat = createHeartbeat({ send, on, lost });

  peer.on("error", (error) => {
    if (error.type === "unavailable-id") on({ type: "taken" });
    else if (error.type === "peer-unavailable") on({ type: "error", text: "No game with that code (is the host still waiting?)" });
    else on({ type: "error", text: `${error.type}: ${error.message}` });
  });

  function use(newConnection) {
    if (connection) {
      newConnection.close(); // a 2-player game: a third visitor is turned away
      return;
    }
    connection = newConnection;
    connection.on("open", () => {
      heartbeat.start();
      on({ type: "connected" });
      // Give WebRTC a moment to settle on its route, then report it.
      setTimeout(() => routeOf(newConnection.peerConnection).then((text) => on({ type: "route", text })), 1500);
    });
    connection.on("data", (message) => {
      if (!heartbeat.receive(message)) on({ type: "message", message });
    });
    connection.on("close", lost); // when WebRTC does notice
  }

  return {
    use,
    send,
    close() {
      heartbeat.leave(); // "bye" to the friend
      // Leave the PeerServer a moment later, so the "bye" goes out first.
      setTimeout(() => peer.destroy(), 200);
      connection = null;
    },
  };
}

// Which way the data goes: WebRTC's statistics (getStats) list the "candidate pair" it chose, a pair
// of addresses, one per browser. If either is a "relay" candidate, the data passes through a TURN
// server; otherwise it goes straight between the two browsers.
async function routeOf(peerConnection) {
  if (!peerConnection) return "route unknown";
  const stats = await peerConnection.getStats();
  let pair = null;
  stats.forEach((report) => {
    if (report.type === "transport" && report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId);
  });
  if (!pair) {
    stats.forEach((report) => {
      if (report.type === "candidate-pair" && report.nominated && report.state === "succeeded") pair = report;
    });
  }
  if (!pair) return "route unknown";
  const types = [stats.get(pair.localCandidateId)?.candidateType, stats.get(pair.remoteCandidateId)?.candidateType];
  return types.includes("relay") ? "through a TURN relay" : "direct";
}
