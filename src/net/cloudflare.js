import { RELAY_URL } from "../data/online.js";
import { createHeartbeat } from "./heartbeat.js";

// Room play's link: both players connect to a room on Cloudflare (relay/room.js), which forwards each
// one's messages to the other. Same functions and events as net/peer.js, so net/online.js can use
// either one.
//
// A WebSocket is a connection that stays open both ways (a normal web request asks once and gets one
// answer). Browsers have them built in: new WebSocket("wss://..."), then send() and onmessage. It runs
// over TCP, so like Quick duel's reliable data channel every message arrives, in order.
//
// Messages are JSON text. The room adds its own: { type: "relay", event: "waiting" | "connected" |
// "where" | "left" | "refused" }; everything else comes from the friend's game.

// Host a room under `code` and wait for a friend. Events: see hostGame in net/peer.js. Here "route"
// says where the room runs and where you came into Cloudflare's network.
export function hostGame(code, on) {
  return connect(code, "host", on);
}

// Join a friend's room by its code.
export function joinGame(code, on) {
  return connect(code, "guest", on);
}

function connect(code, role, on) {
  let open = false; // both players are here (the room said "connected")
  let heard = false; // the room has answered at least once
  let done = false; // we left, were refused, or the host left: the socket closing is expected

  if (!RELAY_URL) {
    // No relay address (DEPLOYED_RELAY left empty in data/online.js).
    setTimeout(() => on({ type: "error", text: "Room play isn't set up yet: the Cloudflare relay hasn't been deployed." }));
    return { send() {}, close() {} };
  }

  const socket = new WebSocket(`${RELAY_URL}/room/${code}?role=${role}`);

  function send(message) {
    if (open && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
  // The friend is gone (said "bye", went silent, or the room told us): say so (once).
  function lost() {
    if (!open) return;
    open = false;
    heartbeat.stop();
    on({ type: "closed" });
  }
  const heartbeat = createHeartbeat({ send, on, lost });

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "relay") {
      heard = true;
      if (message.event === "waiting") on({ type: "code", code }); // the room is ours
      if (message.event === "connected") {
        open = true;
        heartbeat.start();
        on({ type: "connected" });
      }
      if (message.event === "where") on({ type: "route", text: `room in ${message.room}, you enter at ${message.entry}` });
      if (message.event === "left") {
        if (role === "guest") done = true; // the host left: the room closes our connection next
        lost();
      }
      if (message.event === "refused") {
        done = true;
        socket.close(1000, "Refused.");
        on(message.text === "taken" ? { type: "taken" } : { type: "error", text: message.text });
      }
      return;
    }
    if (!heartbeat.receive(message)) on({ type: "message", message });
  };
  socket.onclose = () => {
    if (open) lost();
    if (done) return;
    on({ type: "error", text: heard ? "Lost the connection to the Cloudflare room." : "Couldn't reach the Cloudflare room (is the relay running?)" });
  };

  return {
    send,
    close() {
      heartbeat.leave(); // "bye" to the friend
      open = false;
      done = true; // closing on purpose: no error message
      socket.close(1000, "Left.");
    },
  };
}
