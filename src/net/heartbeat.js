// What every link does once two players are connected, whatever carries the messages (PeerJS in
// net/peer.js, a Cloudflare room in net/cloudflare.js):
//   - a ping every second; the answer gives the round trip (the "ping", in ms), reported as
//     on({ type: "ping", ms }). In Room play it travels through the room, so it's the full trip to
//     your friend and back, the same thing Quick duel measures: the two can be compared;
//   - a "bye" when the tab closes, so the friend knows at once;
//   - SILENCE ms without a word from the friend counts as gone (crashed, lost Wi-Fi): a "heartbeat
//     timeout". Not shorter: a page that's still loading (models, shaders) can be too busy to answer
//     for several seconds.
// send(message) sends to the friend; lost() is called when the friend is gone (by "bye" or silence).

const PING_EVERY = 1000; // milliseconds
const SILENCE = 10000;

export function createHeartbeat({ send, on, lost }) {
  let timer = null;
  let lastHeard = 0; // performance.now() when the friend last sent anything

  const bye = () => send({ type: "bye" });
  window.addEventListener("pagehide", bye); // closing or reloading the tab

  return {
    // The connection is open: start pinging.
    start() {
      lastHeard = performance.now();
      clearInterval(timer);
      timer = setInterval(() => {
        if (performance.now() - lastHeard > SILENCE) lost();
        else send({ type: "ping", sent: performance.now() });
      }, PING_EVERY);
    },
    // Every message from the friend comes here first. Returns true if it was the heartbeat's own
    // (ping, pong, bye: handled here), false for the game's messages.
    receive(message) {
      lastHeard = performance.now();
      if (message.type === "ping") send({ type: "pong", sent: message.sent }); // send it straight back
      else if (message.type === "pong") on({ type: "ping", ms: Math.round(performance.now() - message.sent) });
      else if (message.type === "bye") lost();
      else return false;
      return true;
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    // Leaving on purpose (back to the menu): tell the friend, stop, forget the tab-closing listener.
    leave() {
      bye();
      clearInterval(timer);
      timer = null;
      window.removeEventListener("pagehide", bye);
    },
  };
}
