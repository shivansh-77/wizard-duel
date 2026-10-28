import { DurableObject } from "cloudflare:workers";

// Room play's relay: this file runs on Cloudflare, never in the browser (Vite never bundles it: the
// game doesn't import it). `npm run relay` runs it on this computer, `npm run relay:deploy` uploads it.
//
// Two parts:
//   1. The Worker (export default): every player's WebSocket lands here first, at the Cloudflare data
//      centre nearest that player. It reads the room code from the address and hands the connection
//      to that room.
//   2. The Room (a Durable Object): one per room code, living in ONE data centre (near whoever asked
//      for it first: the host). Both players' WebSockets end in it; whatever one sends, it forwards to
//      the other. It doesn't run the duel: the lockstep, checksums and pings in the game travel
//      through it untouched.
//
// The game's address: wss://<relay>/room/<CODE>?role=host (or guest). Messages from the room itself
// are { type: "relay", event: ... }: "waiting" (your room is open), "connected" (both are here),
// "where" (the room's data centre and yours), "left" (the other player left), "refused" (with `text`,
// then the room closes your connection).

const CODE = /^\/room\/([A-Z0-9]{5})$/; // Room codes are 5 characters (Quick duel's PeerJS codes are 4)

// Pages allowed to open rooms: the game on this computer or the local network, on GitHub Pages and on
// itch.io (which runs HTML games from *.itch.zone). Browsers always send the page's Origin and pages
// can't fake it, so other websites can't use up the free plan's daily allowance. (A program outside a
// browser can send any Origin: this keeps out other sites, not a determined person.)
const ALLOWED_ORIGINS = [
  /^https?:\/\/(localhost|127\.0\.0\.1|10(\.\d+){3}|192\.168(\.\d+){2})(:\d+)?$/,
  /^https:\/\/shivansh-77\.github\.io$/,
  /^https:\/\/([a-z0-9-]+\.)*itch\.zone$/,
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(CODE);
    if (!match) return new Response("Wizard Duel relay: nothing to see here.", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("This address takes WebSockets.", { status: 426 });
    const origin = request.headers.get("Origin") ?? "";
    if (!ALLOWED_ORIGINS.some((allowed) => allowed.test(origin))) return new Response("Not from the game.", { status: 403 });

    // idFromName turns the code into the room's id: the same code gives the same id everywhere, so both
    // players reach the same Room, whichever data centre they came in through. get() gives a "stub" (a
    // remote handle); its fetch() passes the request on to the Room, wherever in the world it lives.
    const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
    // request.cf.colo: the data centre this player came in through (an airport code, e.g. DEL). The
    // Room can't see it, so it travels along as a header.
    const forwarded = new Request(request);
    forwarded.headers.set("X-Entry", request.cf?.colo ?? "here");
    return room.fetch(forwarded);
  },
};

// One room: two players (the host and a guest) for now; more seats and spectators can come later.
// It uses the WebSocket Hibernation API: this.ctx.acceptWebSocket() hands the connections to Cloudflare,
// which calls webSocketMessage() / webSocketClose() below, and may put the Room to sleep between
// messages (its memory is lost then, the connections aren't). So nothing is kept in fields: each
// connection carries a tag ("host" or "guest") and this.ctx.getWebSockets(tag) finds it again.
export class Room extends DurableObject {
  async fetch(request) {
    const role = new URL(request.url).searchParams.get("role") === "host" ? "host" : "guest";
    const entry = request.headers.get("X-Entry");
    const host = this.ctx.getWebSockets("host");
    const guest = this.ctx.getWebSockets("guest");
    let refusal = null;
    if (role === "host" && host.length > 0) refusal = "taken"; // the game picks another code
    if (role === "guest" && host.length === 0) refusal = "No room with that code (is the host still waiting?)";
    if (role === "guest" && guest.length > 0) refusal = "That room is full: it's a duel for two.";

    const pair = new WebSocketPair(); // two connected ends: one for the player, one for us
    const [player, ours] = Object.values(pair);
    // A refused connection gets its own tag, so its closing never disturbs the real host or guest.
    this.ctx.acceptWebSocket(ours, [refusal ? "refused" : role]);
    ours.serializeAttachment({ entry }); // where this player came in (survives hibernation, unlike a field)
    const reply = new Response(null, { status: 101, webSocket: player }); // 101 = "switching to WebSocket"

    if (refusal) refuse(ours, refusal);
    else if (role === "host") send(ours, { event: "waiting" });
    else {
      // The guest is in: tell both at once. Where the room runs follows when it's known (it takes a
      // request to the internet, which must never hold up the duel).
      send(host[0], { event: "connected" });
      send(ours, { event: "connected" });
      this.ctx.waitUntil(
        this.location().then((room) => {
          for (const socket of [host[0], ours]) {
            try {
              send(socket, { event: "where", room, entry: socket.deserializeAttachment()?.entry ?? "?" });
            } catch {
              // that player has already gone
            }
          }
        }),
      );
    }
    return reply;
  }

  // A message from one player: pass it to the other, as it is (we don't even read it).
  webSocketMessage(socket, message) {
    if (this.ctx.getTags(socket)[0] === "refused") return;
    const other = this.other(socket);
    if (other) other.send(message);
  }

  // A player left (closed the tab, lost the connection). If it was the guest, the host stays and a new
  // guest may join; if it was the host, the room is over for the guest too.
  webSocketClose(socket) {
    const role = this.ctx.getTags(socket)[0];
    const other = role === "refused" ? null : this.other(socket);
    if (other) {
      send(other, { event: "left" });
      if (role === "host") other.close(1000, "The host left.");
    }
    try {
      socket.close(1000, "Bye."); // finish the closing handshake (it may already be done)
    } catch {
      // already closed
    }
  }

  webSocketError(socket) {
    this.webSocketClose(socket);
  }

  // The other player's connection, if they're here.
  other(socket) {
    const role = this.ctx.getTags(socket)[0];
    return this.ctx.getWebSockets(role === "host" ? "guest" : "host")[0] ?? null;
  }

  // Which data centre this Room runs in. A Durable Object can't ask directly, but any request it sends
  // out leaves from its own data centre, and Cloudflare's /cdn-cgi/trace page answers with that
  // data centre's code ("colo=BOM"). Asked once per guest: it's only for the game's HUD.
  async location() {
    try {
      const response = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(5000) });
      const trace = await response.text();
      return trace.match(/^colo=(\w+)$/m)?.[1] ?? "?";
    } catch {
      return "?"; // e.g. no internet while testing on this computer
    }
  }
}

function send(socket, message) {
  socket.send(JSON.stringify({ type: "relay", ...message }));
}

// Tell this player why, then close their connection (4000–4999: close codes free for our own use).
function refuse(socket, text) {
  send(socket, { event: "refused", text });
  socket.close(4000, text.slice(0, 120));
}
