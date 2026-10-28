// One number made from the whole duel state (every position, health, cooldown, bolt, serpent...).
// Online, each computer runs its own copy of the duel from the same inputs; if the two copies ever
// differ, even in the last digit of one number, their checksums differ too: that's how a "desync" is
// caught. The state is written out as JSON (every number exactly), then hashed with FNV-1a, a short,
// classic hash. `data` (each wizard's fixed data) and `events` (for the view, emptied every frame)
// are left out.
export function checksum(duel) {
  const text = JSON.stringify(duel, (key, value) => (key === "data" || key === "events" ? undefined : value));
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // a 32-bit multiply: the same result everywhere
  }
  return hash >>> 0; // as a positive whole number
}
