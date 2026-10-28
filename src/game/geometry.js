import { CASTING } from "../data/spells.js";

// Small pieces of geometry the rules share. Everything is seen from above: x and z only.
// Angles are in radians, measured from +z (Babylon's "forward"), like rotation.y.

// The direction from a to b, with length 1.
export function direction(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

// The direction (length 1) of an angle.
export function forward(angle) {
  return { x: Math.sin(angle), z: Math.cos(angle) };
}

// The angle of a direction (dx, dz).
export function angleOf(dx, dz) {
  return Math.atan2(dx, dz);
}

// How far to turn from angle `from` to angle `to`, the short way round: between -π and π.
export function angleBetween(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

// Where a wizard's wand tip is when he points along `dir` (see CASTING).
export function wandTip(wizard, dir) {
  const right = { x: dir.z, z: -dir.x }; // dir turned 90° clockwise, seen from above
  return {
    x: wizard.x + dir.x * CASTING.wandReach + right.x * CASTING.wandSide,
    z: wizard.z + dir.z * CASTING.wandReach + right.z * CASTING.wandSide,
  };
}

// The shortest distance from point p to the line segment from a to b.
export function distanceToSegment(p, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSquared = abx * abx + abz * abz || 1;
  // How far along the segment p's closest point is: 0 at a, 1 at b (clamped to the segment).
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / lengthSquared));
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}
