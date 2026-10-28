import {
  AddBlock,
  AnimatedInputBlockTypes,
  ClampBlock,
  CloudBlock,
  Color3,
  Constants,
  DotBlock,
  FragmentOutputBlock,
  GradientBlock,
  GradientBlockColorStep,
  InputBlock,
  InstancesBlock,
  MaxBlock,
  MultiplyBlock,
  NodeMaterial,
  NodeMaterialSystemValues,
  NormalizeBlock,
  ScaleBlock,
  SmoothStepBlock,
  SubtractBlock,
  TransformBlock,
  Vector3,
  VertexOutputBlock,
  ViewDirectionBlock,
} from "@babylonjs/core";

// How hot a pixel is: heat = facing × FACING + noise × NOISE − CUT, kept between 0 and 1. Facing is 1
// in the middle of the shape (seen from the camera) and 0 at its outline. The noise is about 0.47 on
// average and mostly within ±0.15 of that: NOISE is big to turn those small differences into bright
// flames and dark gaps. The middle comes out around 0.65 (orange), from 0.3 to white-hot, and the
// outline flickers between nothing and red.
const FACING = 0.7;
const NOISE = 2.4;
const CUT = 1.17;
// The noise is stretched upward this much: flames are taller than they are wide.
const STRETCH = new Vector3(1, 0.45, 1);
// The boiling surface is pushed out along its normal, and up this much as well: flames lick upward.
const LIFT = new Vector3(0, 0.8, 0);
// Heat below EDGE_LOW is fully see-through, above EDGE_HIGH fully there: the flames' ragged edge.
const EDGE_LOW = 0.1;
const EDGE_HIGH = 0.32;

// A fire shader built as a NodeMaterial: a graph of blocks (inputs → maths → outputs) that Babylon
// turns into GPU code (GLSL for WebGL, WGSL for WebGPU). Like every shader it has two stages:
//   vertex stage, once per vertex: where the vertex is in the arena, pushed out a little by noise so
//     the surface boils, then where it lands on the screen;
//   fragment stage, once per pixel: how hot the pixel is (rising noise + how much the surface faces
//     the camera), then its colour and how see-through it is.
// `fire` is a spell's fire data (data/spells.js). The time input animates itself, so nothing has to
// update this material each frame. material.serialize() gives JSON the Node Material Editor
// (nme.babylonjs.com) can load: the same graph, drawn as boxes and wires.
export function createFireMaterial(scene, name, fire) {
  const material = new NodeMaterial(name, scene);

  // ---- Inputs ----
  const position = attribute("position"); // the vertex's position, in the mesh's own space
  const normal = attribute("normal"); // which way the surface faces at that vertex
  const world = systemValue("world", NodeMaterialSystemValues.World); // mesh space → arena (world) space
  const viewProjection = systemValue("viewProjection", NodeMaterialSystemValues.ViewProjection); // world → screen
  const cameraPosition = systemValue("cameraPosition", NodeMaterialSystemValues.CameraPosition);
  const time = value("time", 0);
  time.animationType = AnimatedInputBlockTypes.RealTime; // Babylon keeps it = seconds since the game started

  // ---- Vertex stage ----
  // Instances (mesh.createInstance): the GPU draws every copy in one go, and each copy brings its own
  // world matrix as four extra per-instance attributes (world0..world3). InstancesBlock uses those
  // when the mesh is drawn as instances, and the plain world matrix otherwise, so this one material
  // works for both (the sculpted serpent's body is instances of one segment).
  const instances = block(InstancesBlock, "instances", {
    world0: attribute("world0").output,
    world1: attribute("world1").output,
    world2: attribute("world2").output,
    world3: attribute("world3").output,
    world: world.output,
  });
  const worldPosition = block(TransformBlock, "worldPosition", { vector: position.output, transform: instances.output });
  const worldNormal = block(TransformBlock, "worldNormal", { vector: normal.output, transform: instances.output });
  worldNormal.complementW = 0; // a direction, not a point: moving the mesh mustn't move it
  const unitNormal = block(NormalizeBlock, "unitNormal", { input: worldNormal.xyz }); // length 1

  // Where to read the noise: the vertex's arena position, moved down by rise × time, measured in
  // noise sizes. Reading lower and lower makes the pattern climb: the flames rise straight up,
  // whichever way the mesh moves (and a moving serpent leaves its flames behind, like a torch).
  // Squashing the height (× STRETCH) makes each noise shape taller: flame-shaped.
  const down = value("down", new Vector3(0, -fire.rise, 0));
  const sink = block(ScaleBlock, "sink", { input: down.output, factor: time.output });
  const moved = block(AddBlock, "moved", { left: worldPosition.xyz, right: sink.output });
  const perNoiseSize = value("perNoiseSize", 1 / fire.noiseSize);
  const inNoiseSizes = block(ScaleBlock, "inNoiseSizes", { input: moved.output, factor: perNoiseSize.output });
  const noiseSeed = block(MultiplyBlock, "noiseSeed", { left: inNoiseSizes.output, right: value("stretch", STRETCH).output });

  // Boil: push the vertex out along its normal by a little noise. CloudBlock = fractal noise (fBm):
  // layers ("octaves") of smooth random noise, each twice as fine and half as strong. 2 octaves here:
  // only the big shapes (the vertices are too far apart for fine detail anyway).
  const boilNoise = block(CloudBlock, "boilNoise", { seed: noiseSeed.output });
  boilNoise.octaves = 2;
  const wobble = value("wobble", fire.wobble);
  const boilAmount = block(ScaleBlock, "boilAmount", { input: boilNoise.output, factor: wobble.output });
  const pushDirection = block(AddBlock, "pushDirection", { left: unitNormal.output, right: value("lift", LIFT).output });
  const push = block(ScaleBlock, "push", { input: pushDirection.output, factor: boilAmount.output });
  const boiled = block(AddBlock, "boiled", { left: worldPosition.xyz, right: push.output });
  const onScreen = block(TransformBlock, "onScreen", { vector: boiled.output, transform: viewProjection.output });
  const vertexOutput = block(VertexOutputBlock, "vertexOutput", { vector: onScreen.output });

  // ---- Fragment stage: how hot is this pixel? ----
  // The same noise, now per pixel and with 4 octaves: big flame shapes plus finer and finer detail.
  const flameNoise = block(CloudBlock, "flameNoise", { seed: noiseSeed.output });
  flameNoise.octaves = 4;
  // Facing: the dot product of two length-1 directions (to the camera, and the surface's normal) is
  // 1 where the surface faces the camera and 0 where it turns away, at the outline.
  const toCamera = block(ViewDirectionBlock, "toCamera", { worldPosition: worldPosition.output, cameraPosition: cameraPosition.output });
  const facingDot = block(DotBlock, "facingDot", { left: toCamera.output, right: unitNormal.output });
  const facing = block(MaxBlock, "facing", { left: facingDot.output, right: value("zero", 0).output }); // never below 0
  const hotMiddle = block(ScaleBlock, "hotMiddle", { input: facing.output, factor: value("facingWeight", FACING).output });
  const flicker = block(ScaleBlock, "flicker", { input: flameNoise.output, factor: value("noiseWeight", NOISE).output });
  const heatSum = block(AddBlock, "heatSum", { left: hotMiddle.output, right: flicker.output });
  const heatCut = block(SubtractBlock, "heatCut", { left: heatSum.output, right: value("cut", CUT).output });
  const heat = block(ClampBlock, "heat", { value: heatCut.output }); // a ClampBlock keeps it in 0..1

  // ---- Heat → colour and see-through-ness ----
  // GradientBlock: a colour ramp. Heat 0 picks the first colour, 1 the last, in between a blend.
  const colorRamp = new GradientBlock("colorRamp");
  colorRamp.colorSteps = fire.colors.map(
    (hex, i) => new GradientBlockColorStep(i / (fire.colors.length - 1), Color3.FromHexString(hex)),
  );
  heat.output.connectTo(colorRamp.gradient);
  const color = block(ScaleBlock, "color", { input: colorRamp.output, factor: value("brightness", fire.brightness).output });
  // SmoothStep: 0 below edgeLow, 1 above edgeHigh, a smooth S-curve between: cool pixels vanish.
  const alpha = block(SmoothStepBlock, "alpha", {
    value: heat.output,
    edge0: value("edgeLow", EDGE_LOW).output,
    edge1: value("edgeHigh", EDGE_HIGH).output,
  });
  // `glow` is the colour this mesh gives the GlowLayer (used only when the GlowLayer draws it).
  const glowColor = block(ScaleBlock, "glowColor", { input: colorRamp.output, factor: value("glow", fire.glow).output });
  const fragmentOutput = block(FragmentOutputBlock, "fragmentOutput", { rgb: color.output, a: alpha.output, glow: glowColor.output });

  material.addOutputNode(vertexOutput);
  material.addOutputNode(fragmentOutput);
  material.build(); // turn the graph into shader code

  // How the fire mixes with what's behind it. ALPHA_PREMULTIPLIED: on screen = fire colour +
  // what's behind × (1 − alpha). The colour is added, like light (black adds nothing), and where the
  // fire is solid (alpha near 1) it also hides what's behind: pure adding (ALPHA_ADD) washed out to
  // white over the pale platform.
  material.alphaMode = Constants.ALPHA_PREMULTIPLIED;
  material.forceAlphaBlending = true;
  material.disableDepthWrite = true; // see-through: it mustn't hide what's drawn after it
  return material;
}

// ---- Small helpers that make the graph above read like a recipe ----

// Makes a block and plugs outputs into its inputs, e.g.
// block(ScaleBlock, "sink", { input: down.output, factor: time.output }).
function block(BlockClass, name, inputs) {
  const node = new BlockClass(name);
  for (const [inputName, from] of Object.entries(inputs)) from.connectTo(node[inputName]);
  return node;
}

// A per-vertex value from the mesh ("position", "normal", "uv"...).
function attribute(name) {
  const input = new InputBlock(name);
  input.setAsAttribute(name);
  return input;
}

// A value Babylon fills in itself every frame (the mesh's world matrix, the camera's position...).
function systemValue(name, kind) {
  const input = new InputBlock(name);
  input.setAsSystemValue(kind);
  return input;
}

// A number or vector we choose. It's a "uniform": the same for every vertex and pixel, and it can be
// changed while the game runs, e.g. material.getBlockByName("brightness").value = 3.
function value(name, initial) {
  const input = new InputBlock(name);
  input.value = initial;
  return input;
}
