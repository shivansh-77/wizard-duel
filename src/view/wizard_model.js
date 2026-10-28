import { Color3, LoadAssetContainerAsync, MeshBuilder, TransformNode, Vector3 } from "@babylonjs/core";
import "@babylonjs/loaders/glTF"; // teaches Babylon to read .gltf / .glb files
import { createMaterial } from "./materials.js";

// A wizard's real, animated model (step 13), replacing his stand-in. It comes from a .glb made by
// blender/02_combine.py: one skinned mesh, a Mixamo skeleton, and one AnimationGroup per clip (idle,
// cast, beam...). data/wizards.js says which clip plays for each moment of the duel.

const CLIP_FPS = 30; // the frame numbers in data/wizards.js are Mixamo's, 30 a second
const BLENDING_SPEED = 0.08; // how quickly one clip eases into the next (a share per frame): lower = smoother
const MOMENT_BLENDING_SPEED = 0.2; // a moment (cast, hit, special) takes over within ~5 frames: it must keep up with the spell
const HIPS = "mixamorig:Hips"; // the skeleton's root bone: moving it moves the whole body
const WAND_LENGTH = 36; // centimetres, like the hand bone it hangs from

// Loads the model and hangs it under `parent` (the wizard's body node, which glides and bobs).
// Resolves to a player: sync(state) every frame picks the clip; trigger(key) starts a one-off moment.
export async function loadWizardModel(scene, shadows, data, parent) {
  // An AssetContainer holds everything in the file (meshes, skeleton, animations) until we add it.
  const container = await LoadAssetContainerAsync(data.model.file, scene);
  container.addAllToScene();

  // The loader puts the model under a "__root__" node that turns glTF's right-handed axes into
  // Babylon's left-handed ones. Hanging that node under the body makes the model follow the wizard.
  container.meshes[0].parent = parent;
  const meshes = container.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
  for (const mesh of meshes) {
    mesh.receiveShadows = true;
    shadows.addShadowCaster(mesh);
    mesh.overlayColor = Color3.White(); // the hit flash (view/wizard.js)
  }
  let wandTip = null; // where spells start; without a wand of ours, the stand-in's tip stays in use
  if (data.model.wand) {
    const wand = addWand(scene, data, container, shadows);
    meshes.push(wand.stick);
    wandTip = wand.tip;
  }

  // One AnimationGroup per clip, found by its name. The loader starts the first one: stop them all.
  // Clips marked rootMotion (the KO) may carry him away; the others are kept on his spot.
  const moving = Object.values(data.model.clips).filter((clip) => clip.rootMotion).map((clip) => clip.name);
  const groups = {};
  for (const group of container.animationGroups) {
    group.stop();
    group.enableBlending = true; // a new clip eases in from the pose the last one left
    group.blendingSpeed = BLENDING_SPEED;
    if (!moving.includes(group.name)) keepInPlace(group);
    groups[group.name] = group;
  }
  return { meshes, wandTip, ...createPlayer(groups, data.model.clips) };
}

// Root motion: Mixamo clips move the whole body (the hit staggers him a metre back, the whip lunges
// forward). But the rules already decide where he is, so the hips are pinned over the spot they start
// on: every key keeps its height and loses its drift along the floor. In the skeleton's space x and y
// run along the floor and z is the height.
function keepInPlace(group) {
  for (const { target, animation } of group.targetedAnimations) {
    if (target.name !== HIPS || animation.targetProperty !== "position") continue;
    const keys = animation.getKeys(); // the keyframes: { frame, value } with a Vector3 value
    const { x, y } = keys[0].value;
    for (const key of keys) key.value = new Vector3(x, y, key.value.z);
    animation.setKeys(keys);
  }
}

// Plays the clips. A "moment" (cast, hit, special) plays once to its end; otherwise the rules' state
// decides: knocked out, beaming, shielding, or idle.
function createPlayer(groups, clips) {
  let playing = null; // the clip key playing now
  let moment = null; // a one-off clip still playing to its end
  const before = { cast: 0, special: 0 }; // last frame's wind-up timers, to spot one starting

  function start(key) {
    const clip = clips[key];
    const group = groups[clip.name];
    if (!group) return;
    for (const other of Object.values(groups)) {
      if (other !== group) other.stop(); // it leaves the bones where they are: the new clip blends from there
    }
    // The clip's own frame rate (the loader's, maybe not 30): convert Mixamo's frame numbers to it.
    const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? CLIP_FPS;
    const from = clip.from !== undefined ? (clip.from / CLIP_FPS) * fps : group.from;
    const to = clip.to !== undefined ? (clip.to / CLIP_FPS) * fps : group.to;
    group.blendingSpeed = key === moment ? MOMENT_BLENDING_SPEED : BLENDING_SPEED;
    group.start(Boolean(clip.loop), clip.speed ?? 1, from, to); // not looping: it stops on its last frame
    playing = key;
  }

  function play(key) {
    if (playing !== key) start(key);
  }

  function trigger(key) {
    const group = groups[clips[key].name];
    if (!group) return;
    group.stop(); // so the same moment can start again from its beginning
    moment = key;
    start(key);
    group.onAnimationGroupEndObservable.addOnce(() => {
      if (moment === key) moment = null; // done: the state takes over again
    });
  }

  function sync(state) {
    // The cast and special clips start with the rules' wind-up, not when the spell leaves at its end:
    // that way the gesture peaks just as the spell flies (data/wizards.js frames are fitted to it).
    if (state.castTimer > 0 && before.cast === 0) trigger("cast");
    if (state.specialTimer > 0 && before.special === 0) trigger("special");
    before.cast = state.castTimer;
    before.special = state.specialTimer;
    if (state.down) {
      moment = null;
      play("ko");
    } else if (moment) {
      // let the moment finish
    } else if (state.beaming || state.beamTimer > 0) {
      play("beam");
    } else if (state.shieldUp) {
      play("shield");
    } else {
      play("idle");
    }
  }

  return { sync, trigger };
}

// A wand for a model that has none, held in the hand. It hangs under the hand bone's node, so it
// follows every animation. That node lives in the skeleton's units, centimetres (Mixamo's), so the
// wand is built in centimetres too. Returns the stick and an empty node at its tip.
function addWand(scene, data, container, shadows) {
  const hand = container.transformNodes.find((node) => node.name === data.model.wand.bone);
  const stick = MeshBuilder.CreateCylinder(
    `${data.name}ModelWand`, // "Model": the stand-in already has a "DumbledoreWand"
    { height: WAND_LENGTH, diameterTop: 1.2, diameterBottom: 2.2, tessellation: 8 },
    scene,
  );
  stick.material = createMaterial(`${data.name}ModelWandMat`, data.colors.wand, scene);
  stick.parent = hand;
  // Bone space: +y runs along the fingers. Lay the wand across the closed fist, poking out forward.
  stick.position.set(0, 8, 2);
  stick.rotation.x = Math.PI / 2;
  shadows.addShadowCaster(stick);
  stick.overlayColor = Color3.White();

  // The thin end (the cylinder's top, +y) is the tip: bolts, the beam and the whip start there.
  const tip = new TransformNode(`${data.name}ModelWandTip`, scene);
  tip.parent = stick;
  tip.position.y = WAND_LENGTH / 2;
  return { stick, tip };
}
