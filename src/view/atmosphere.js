import { Color3, Color4, Scene } from "@babylonjs/core";
import { ARENA } from "../data/arena.js";

// The "air" of the hall: the background colour, and the fog that fades far things into it.
export function setupAtmosphere(scene) {
  const background = Color3.FromHexString(ARENA.colors.background);

  // What the screen is cleared to before each frame (a Color4: the 4th number is opacity).
  scene.clearColor = Color4.FromColor3(background);

  // Linear fog: none closer than fogStart, full fog colour past fogEnd, a smooth blend between.
  // The fog has the background's colour, so the far floor melts into the dark instead of
  // ending at a hard edge.
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = ARENA.fog.start;
  scene.fogEnd = ARENA.fog.end;
  scene.fogColor = background;
}
