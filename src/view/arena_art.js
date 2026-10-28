import { DynamicTexture, Texture } from "@babylonjs/core";
import { ARENA } from "../data/arena.js";

// The arena's pictures, drawn in code on DynamicTextures (a texture with a 2D canvas to draw on, like
// the particles' dot in view/effects.js): no image files, so nothing to download or license.
// Math.random is fine here: it's only looks, drawn once.

const SIZE = 1024; // pixels across the platform's top picture
const CENTRE = SIZE / 2;
const SCALE = CENTRE / ARENA.radius; // pixels per metre

// The platform's top: slabs of stone in rings, a magic circle in the middle. Returns two textures:
// `stone` (the colours) and `glow` (only the runes and the circle's lines, on black): used as the
// material's emissive texture, so they shine by themselves and the GlowLayer gives them a halo.
export function drawPlatformTop(scene) {
  const stone = new DynamicTexture("platformStone", SIZE, scene, true);
  const glow = new DynamicTexture("platformGlow", SIZE, scene, true);
  const ctx = stone.getContext();
  const light = glow.getContext();

  // 1. The stone: lighter in the middle, a little darker toward the edge.
  const base = ctx.createRadialGradient(CENTRE, CENTRE, 0, CENTRE, CENTRE, CENTRE);
  base.addColorStop(0, shade(ARENA.colors.stone, 1.12));
  base.addColorStop(1, shade(ARENA.colors.stone, 0.82));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // 2. Slabs: each ring between two joints is cut into slabs about slabLength long. Every slab gets
  //    a slightly different shade, and the joints are dark lines.
  const rings = [0, ...ARENA.slabRings, ARENA.radius];
  for (let r = 1; r < rings.length - 1; r++) {
    const inner = rings[r] * SCALE;
    const outer = rings[r + 1] * SCALE;
    const count = Math.max(6, Math.round((2 * Math.PI * rings[r + 1]) / ARENA.slabLength));
    const offset = r % 2 ? 0.5 : 0; // brick-like: joints don't line up from ring to ring
    for (let s = 0; s < count; s++) {
      const from = ((s + offset) / count) * 2 * Math.PI;
      const to = ((s + 1 + offset) / count) * 2 * Math.PI;
      ctx.beginPath();
      ctx.arc(CENTRE, CENTRE, outer, from, to);
      ctx.arc(CENTRE, CENTRE, inner, to, from, true);
      ctx.closePath();
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"}, ${0.03 + Math.random() * 0.07})`;
      ctx.fill();
      ctx.strokeStyle = ARENA.colors.joints;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  // 3. Speckles, so the slabs look like stone and not plastic.
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"}, ${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * SIZE, Math.random() * SIZE, 2, 2);
  }

  // 4. The magic circle in the middle: engraved in the stone and faintly glowing.
  light.fillStyle = "#000000";
  light.fillRect(0, 0, SIZE, SIZE);
  drawCircle(ctx, ARENA.colors.joints, 4);
  drawCircle(light, withAlpha(ARENA.colors.runes, 0.45), 3);

  // 5. The ring of runes near the edge, between two thin lines. Each rune is a few random strokes,
  //    standing up along the ring like letters around a coin.
  const runeRadius = ARENA.runeRadius * SCALE;
  for (const pen of [ctx, light]) {
    pen.strokeStyle = pen === ctx ? ARENA.colors.joints : ARENA.colors.runes;
    pen.lineWidth = pen === ctx ? 3 : 2.5;
    for (const r of [runeRadius - 16, runeRadius + 16]) {
      pen.beginPath();
      pen.arc(CENTRE, CENTRE, r, 0, 2 * Math.PI);
      pen.stroke();
    }
  }
  const runes = 96;
  for (let i = 0; i < runes; i++) {
    const angle = (i / runes) * 2 * Math.PI;
    const strokes = randomRune();
    for (const pen of [ctx, light]) {
      pen.save();
      pen.translate(CENTRE + Math.cos(angle) * runeRadius, CENTRE + Math.sin(angle) * runeRadius);
      pen.rotate(angle + Math.PI / 2);
      pen.beginPath();
      for (const [x1, y1, x2, y2] of strokes) {
        pen.moveTo(x1, y1);
        pen.lineTo(x2, y2);
      }
      pen.stroke();
      pen.restore();
    }
  }

  stone.update();
  glow.update();
  return { stone, glow };
}

// The hall's floor: big polished tiles of dark stone (4 × 4 tiles in one picture, repeated).
export function drawFloorTiles(scene) {
  const size = 512;
  const tiles = 4;
  const texture = new DynamicTexture("floorTiles", size, scene, true);
  const ctx = texture.getContext();
  const step = size / tiles;
  for (let row = 0; row < tiles; row++) {
    for (let col = 0; col < tiles; col++) {
      ctx.fillStyle = shade(ARENA.colors.floor, 0.85 + Math.random() * 0.35);
      ctx.fillRect(col * step, row * step, step, step);
    }
  }
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  ctx.lineWidth = 4;
  for (let i = 0; i <= tiles; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, size);
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
    ctx.stroke();
  }
  texture.wrapU = Texture.WRAP_ADDRESSMODE; // repeat it across the whole floor
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.update();
  return texture;
}

// The magic circle: two rings and an eight-pointed star drawn with straight lines.
function drawCircle(pen, color, width) {
  const r = ARENA.circleRadius * SCALE;
  pen.strokeStyle = color;
  pen.lineWidth = width;
  for (const radius of [r, r * 0.85]) {
    pen.beginPath();
    pen.arc(CENTRE, CENTRE, radius, 0, 2 * Math.PI);
    pen.stroke();
  }
  pen.beginPath();
  for (let i = 0; i <= 8; i++) {
    const angle = ((i * 3) / 8) * 2 * Math.PI; // jump 3 points each time: a star, not an octagon
    const x = CENTRE + Math.cos(angle) * r * 0.85;
    const y = CENTRE + Math.sin(angle) * r * 0.85;
    if (i === 0) pen.moveTo(x, y);
    else pen.lineTo(x, y);
  }
  pen.stroke();
}

// 2 to 4 strokes inside a 20 × 24 pixel box, centred on (0, 0).
function randomRune() {
  const point = () => [Math.round(Math.random() * 2 - 1) * 9, Math.round(Math.random() * 2 - 1) * 11];
  return Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => [...point(), ...point()]);
}

// A "#rrggbb" colour made lighter (amount > 1) or darker (amount < 1).
function shade(hex, amount) {
  const channels = [1, 3, 5].map((i) => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * amount)));
  return `rgb(${channels.join(",")})`;
}

function withAlpha(hex, alpha) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${channels.join(",")}, ${alpha})`;
}
