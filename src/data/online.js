// The two ways to play a friend online (net/online.js), as data: the menu, the HUD and the links read
// these. Each has its own kind of code, so a code typed in the wrong place is recognised by its length.
export const ONLINE_MODES = {
  quick: {
    title: "Quick duel",
    via: "PeerJS",
    about: "Straight from your browser to your friend's (PeerJS, WebRTC).",
    codeLength: 4,
  },
  room: {
    title: "Room",
    via: "Cloudflare",
    about: "Through a room on Cloudflare's network (a Worker and a Durable Object).",
    codeLength: 5,
  },
};

// Codes use these characters: no 0/O or 1/I, which look alike when read out.
export const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Room play's relay (relay/room.js), on Cloudflare: the address `npm run relay:deploy` printed, with
// wss:// (a secure WebSocket) instead of https://.
const DEPLOYED_RELAY = "wss://wizard-duel-relay.astrapix.workers.dev";
// To try changes to relay/room.js before deploying them, run `npm run relay` and open the game with
// ?relay=local at the end of its address: then it uses the relay on this computer. (127.0.0.1 rather
// than "localhost": on Windows, "localhost" tries IPv6 first, where the relay isn't listening, and a
// WebSocket can take 20 seconds or more to give up and try again.)
const relayHost = location.hostname === "localhost" ? "127.0.0.1" : location.hostname;
const LOCAL_RELAY = new URLSearchParams(location.search).get("relay") === "local";
export const RELAY_URL = LOCAL_RELAY ? `ws://${relayHost}:8787` : DEPLOYED_RELAY;
