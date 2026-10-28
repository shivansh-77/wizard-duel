import {
  CapsuleBlock,
  ComputeNormalsBlock,
  ConditionBlock,
  ConditionBlockTests,
  CylinderBlock,
  GeometryClampBlock,
  GeometryInputBlock,
  GeometryOutputBlock,
  GeometryPowBlock,
  GeometryTransformBlock,
  GeometryTrigonometryBlock,
  GeometryTrigonometryBlockOperations,
  InstantiateLinearBlock,
  MathBlock,
  MathBlockOperations,
  MergeGeometryBlock,
  NodeGeometry,
  NodeGeometryBlockConnectionPointTypes,
  NodeGeometryContextualSources,
  NoiseBlock,
  SetPositionsBlock,
  SphereBlock,
  Vector3,
  VectorConverterBlock,
} from "@babylonjs/core";

// Fiendfyre's body and tail, built with **Node Geometry**: the code version of the Node Geometry
// Editor (nge.babylonjs.com). A NodeGeometry is a graph of blocks: "source" blocks make a shape
// (a capsule, a cone...), other blocks transform, merge or reshape it, and a GeometryOutputBlock at the
// end receives the finished shape. You wire a block's output port to another block's input port with
// `output.connectTo(input)`; `graph.build()` runs the graph once and `graph.createMesh()` turns the
// result into a Mesh.
//
// Two pieces, both templates (hidden, no material): the caller draws them with createInstance().
// - segment: one lumpy, spiky chunk of body. Copies are laid along the serpent's path, overlapping.
// - tailTip: the end of the tail, tapering to an up-curled point, with a fin of spikes.
//
// Units are metres; +y is up; +z is FORWARD, toward the head.

// One body chunk. Neighbours sit SERPENT_BODY.spacing apart, so each overlaps the next by ~0.25 m
// and the body reads as one tube, not a string of beads. Its front end is round and its back end
// long and gently narrowing: the back slides into the next (smaller) segment at a shallow angle, so
// the joins show as soft creases instead of rings.
const SEGMENT = {
  capsule: 0.56, // the capsule's length before the ends are stretched
  radius: 0.25, // half its width (0.5 m wide)...
  flatten: 0.9, // ...and its height is this much of its width (0.45 m tall)
  frontStretch: 1.1, // the front half's length × this (front end at z ≈ +0.31)
  backStretch: 1.25, // the back half's length × this (back end at z ≈ -0.34)
  taper: 0.15, // per metre along z: the front is a little fatter, like a body narrowing to the tail
  lumpSize: 0.04, // how far the noise can push the surface in or out (a few cm)
  lumpScale: 7, // the noise's scale: bigger = smaller, busier lumps
};

// Where the spikes go on a segment (the spike is 1 m tall before `size` scales it).
const SEGMENT_SPIKES = [
  { name: "dorsalSpike", size: 0.3, at: new Vector3(0, 0.16, 0.06), turn: new Vector3(-0.25, 0, 0) },
  { name: "dorsalSpikeSmall", size: 0.19, at: new Vector3(0, 0.15, -0.18), turn: new Vector3(-0.35, 0, 0) },
  // Side spikes: rolled outward (rotation.z), so they stick out of the flanks and sweep back.
  { name: "sideSpikeLeft", size: 0.17, at: new Vector3(-0.19, 0, -0.02), turn: new Vector3(0, 0, 1.3) },
  { name: "sideSpikeRight", size: 0.17, at: new Vector3(0.19, 0, -0.02), turn: new Vector3(0, 0, -1.3) },
];

// The tail tip: starts at z = 0 as thick as a segment scaled by `joinScale`, ends in a point at
// z = -length.
const TAIL = {
  joinScale: 0.35, // the scale of the last segment it joins
  length: 1.1,
  taperPower: 0.75, // the thickness goes as (1 - t)^taperPower: below 1 = plump, then a sharp point
  curl: 0.25, // how far (m) the tip curls up, growing as t³
  lumpSize: 0.25, // like SEGMENT.lumpSize, but in "tube radii" (the tube is 1 unit thick before shaping)
  lumpScale: 3,
  finSpikes: 4, // the fin: a row of spikes along the top, smaller and smaller toward the tip
  finStart: 0.06, // metres behind z = 0 for the first spike
  finGap: 0.2, // metres between spikes
  finSize: 0.13, // the first spike's height (m)
  finShrink: 0.17, // each next spike is this much smaller (a fraction of the first)
};

// Handy numbers for the caller laying the body out.
export const SERPENT_BODY = {
  segmentLength: 0.65, // z from about -0.36 (back) to +0.29 (front)
  spacing: 0.4, // metres between segment centres (at scale 1; multiply by the segment's scale)
  tailScale: TAIL.joinScale, // the last segment's scale, which the tail tip matches
  tailLength: TAIL.length,
};

export function createSerpentBodyGeometry(scene) {
  const graphs = { segment: buildSegmentGraph(), tailTip: buildTailGraph() };
  const meshes = {};
  for (const [key, graph] of Object.entries(graphs)) {
    graph.build(); // runs every block once, from the sources to the output: makes a VertexData
    const mesh = graph.createMesh(`serpent_${key}`, scene);
    mesh.isVisible = false; // a template: instances of it still draw (see view/specials.js)
    meshes[key] = mesh;
  }
  return { meshes, graphs };
}

// ---- The segment ----

function buildSegmentGraph() {
  const graph = new NodeGeometry("serpentSegment");
  // Contextual inputs: values a block reads per vertex from the geometry it is working on (here, the
  // vertex's position and its normal, the direction the surface faces there).
  const positions = contextual("positions", NodeGeometryContextualSources.Positions);
  const normals = contextual("normals", NodeGeometryContextualSources.Normals);

  // 1. The body: a CapsuleBlock (a cylinder with round ends) is built standing along y; a
  //    GeometryTransformBlock lays it down along z (rotation.x a quarter turn).
  const capsule = new CapsuleBlock("bodyCapsule");
  capsule.height.value = SEGMENT.capsule; // the whole length, round ends included
  capsule.radius.value = SEGMENT.radius;
  capsule.tessellation.value = 14; // vertices around
  capsule.subdivisions.value = 2; // rings along the straight middle
  const lying = transform("bodyLieDown", capsule.geometry, { rotation: new Vector3(Math.PI / 2, 0, 0) });

  // 2. Reshape it vertex by vertex with a SetPositionsBlock: it runs its `positions` input once per
  //    vertex and moves the vertex there. The blocks wired into that input are a little formula:
  //      new position = position × (swell, swell × flatten, stretch) + normal × lump
  //    swell = 1 + taper × z (fatter at the front); stretch = backStretch behind the middle and
  //    frontStretch in front of it (a ConditionBlock: "if z < 0 then this, else that"); lump comes
  //    from a NoiseBlock.
  const { z } = split("bodySplit", positions);
  const swell = add("bodySwell", multiply("bodyTaper", z, float("taper", SEGMENT.taper)), float("one", 1));
  const stretch = new ConditionBlock("bodyStretch");
  stretch.test = ConditionBlockTests.LessThan;
  z.connectTo(stretch.left); // stretch.right is left unwired: its value, 0
  float("backStretch", SEGMENT.backStretch).connectTo(stretch.ifTrue);
  float("frontStretch", SEGMENT.frontStretch).connectTo(stretch.ifFalse);
  const squash = join("bodySquash", swell, multiply("bodyFlatten", swell, float("flatten", SEGMENT.flatten)), stretch.output);
  const shaped = multiply("bodyShaped", positions, squash); // vector × vector multiplies x by x, y by y, z by z
  const lumpy = add("bodyLumpy", shaped, lumps("body", normals, SEGMENT, new Vector3(3.1, 7.7, 1.3)));
  const body = setPositions("bodyShape", lying, lumpy);

  // 3. The spikes: ONE curved spike, wired into four transform blocks (an output can feed any number
  //    of inputs), each placing a copy.
  const spike = curvedSpike("segment");
  const placed = SEGMENT_SPIKES.map(({ name, size, at, turn }) =>
    transform(name, spike, { scaling: new Vector3(size, size, size), rotation: turn, translation: at }),
  );

  // 4. MergeGeometryBlock: up to five shapes into one (still separate surfaces, just one mesh), then
  //    ComputeNormalsBlock works out new normals for the reshaped surface, so lighting follows the lumps.
  return finish(graph, merge("segmentMerge", [body, ...placed]));
}

// ---- The tail tip ----

function buildTailGraph() {
  const graph = new NodeGeometry("serpentTailTip");
  const positions = contextual("positions", NodeGeometryContextualSources.Positions);
  const normals = contextual("normals", NodeGeometryContextualSources.Normals);
  const width = SEGMENT.radius * TAIL.joinScale; // half-width and half-height where it joins
  const height = width * SEGMENT.flatten;

  // 1. A tube 1 unit thick and TAIL.length long: a CylinderBlock (built along y, centred), laid
  //    along -z so it runs from z = 0 (the root) back to z = -length (the tip).
  const cylinder = new CylinderBlock("tailTube");
  cylinder.height.value = TAIL.length;
  cylinder.diameter.value = 2; // radius 1: the shaping below multiplies it to the real thickness
  cylinder.tessellation.value = 12;
  cylinder.subdivisions.value = 18; // rings along it: enough to bend smoothly
  const laid = transform("tailLay", cylinder.geometry, {
    rotation: new Vector3(-Math.PI / 2, 0, 0), // +y now points to -z
    translation: new Vector3(0, 0, -TAIL.length / 2),
  });

  // 2. A few numbers per vertex, from how far along the tail it is. These blocks are SHARED by the
  //    tube's and the fin's SetPositions below: a graph is a formula, not a stored value, so it is
  //    worked out again for each vertex of whichever geometry is being processed.
  //      t = -z / length (0 at the root, 1 at the tip; clamped to stay in 0..1)
  //      thickness = (1 - t)^taperPower
  //      lift = curl × t³
  const { z } = split("tailSplit", positions);
  const t = clamp("tailT", multiply("tailAlong", z, float("perMetre", -1 / TAIL.length)), 0, 1);
  const thickness = pow("tailThickness", trig("tailLeft", GeometryTrigonometryBlockOperations.OneMinus, t), float("taperPower", TAIL.taperPower));
  const lift = multiply("tailLift", pow("tailCurve", t, float("three", 3)), float("curl", TAIL.curl));
  const liftUp = join("tailLiftUp", null, lift, null); // an unconnected converter input counts as 0

  // 3. Shape the tube: lumps first (while it's still 1 unit thick, and only sideways: × (1, 1, 0)),
  //    then squeeze it to its thickness at t and curl it up:
  //      new position = (position + lump) × (width × thickness, height × thickness, 1) + (0, lift, 0)
  const sideways = multiply("tailLumpSideways", lumps("tail", normals, TAIL, new Vector3(5.3, 2.9, 8.1)), vector("noZ", 1, 1, 0));
  const lumpy = add("tailLumpy", positions, sideways);
  const squeeze = join("tailSqueeze", multiply("tailWidth", thickness, float("width", width)), multiply("tailHeight", thickness, float("height", height)), float("keepZ", 1));
  const tube = setPositions("tailShape", laid, add("tailCurled", multiply("tailSqueezed", lumpy, squeeze), liftUp));

  // 4. Round the root: a small ellipsoid (SphereBlock with its own diameter per axis) as thick as
  //    the root, so the joint into the last segment is never a flat disc.
  const cap = new SphereBlock("tailRootCap");
  cap.segments.value = 6;
  cap.diameterX.value = width * 2;
  cap.diameterY.value = height * 2;
  cap.diameterZ.value = 0.16;

  // 5. The fin: an InstantiateLinearBlock copies the spike `finSpikes` times, each one `direction`
  //    further back and `scaling` smaller than the last (both are steps per copy). Then a
  //    SetPositions lifts every fin vertex onto the tube's top at its own t (the same t, thickness
  //    and lift blocks as the tube), so the fin rides the taper and the curl.
  const row = new InstantiateLinearBlock("tailFinRow");
  transform("tailFinSize", curvedSpike("tail"), { scaling: new Vector3(TAIL.finSize, TAIL.finSize, TAIL.finSize) }).connectTo(row.instance);
  row.count.value = TAIL.finSpikes;
  row.direction.value = new Vector3(0, 0, -TAIL.finGap);
  row.scaling.value = new Vector3(-TAIL.finShrink, -TAIL.finShrink, -TAIL.finShrink);
  const fin = transform("tailFinStart", row.output, { translation: new Vector3(0, 0, -TAIL.finStart) });
  const onTop = add("tailFinRise", multiply("tailFinTop", thickness, float("finBase", height * 0.75)), lift);
  const riding = setPositions("tailFinRide", fin, add("tailFinLifted", positions, join("tailFinUp", null, onTop, null)));

  return finish(graph, merge("tailMerge", [tube, cap.geometry, riding]));
}

// ---- A curved spike (shared by both graphs) ----

// A blade-like horn 1 m tall: its base at the origin, pointing up (+y), its tip swept back (-z).
// Each call makes new blocks (a block belongs to one graph).
function curvedSpike(prefix) {
  const positions = contextual(`${prefix}SpikePositions`, NodeGeometryContextualSources.Positions);
  const cone = new CylinderBlock(`${prefix}SpikeCone`); // a cylinder with a 0-wide top is a cone
  cone.height.value = 1;
  cone.diameterTop.value = 0;
  cone.diameterBottom.value = 0.36;
  cone.tessellation.value = 6;
  cone.subdivisions.value = 4; // rings up the cone, so it can bend
  // Thin it sideways into a blade (scaling.x), and lift it so its base sits on the origin.
  const standing = transform(`${prefix}SpikeStand`, cone.geometry, {
    scaling: new Vector3(0.45, 1, 1),
    translation: new Vector3(0, 0.5, 0),
  });
  // Sweep it back like a horn: z goes back by 0.45 × y², so the higher, the further back.
  const { y } = split(`${prefix}SpikeSplit`, positions);
  const back = multiply(`${prefix}SpikeBack`, multiply(`${prefix}SpikeY2`, y, y), float(`${prefix}SpikeSweepAmount`, -0.45));
  return setPositions(`${prefix}SpikeSweep`, standing, add(`${prefix}SpikeSwept`, positions, join(`${prefix}SpikeBackVec`, null, null, back)));
}

// The noise lumps, as a vector to add to the position: normal × (noise - 0.5) × lumpSize.
// A NoiseBlock gives a smooth random value (Perlin noise) between 0 and 1 for each vertex, from
// the vertex's position × scale + offset (the offset picks a different pattern).
function lumps(prefix, normals, { lumpSize, lumpScale }, offset) {
  const noise = new NoiseBlock(`${prefix}Noise`);
  noise.scale.value = lumpScale;
  noise.octaves.value = 2; // layers of finer noise on top
  noise.roughness.value = 0.5; // how strong each finer layer is
  noise.offset.value = offset;
  const centred = add(`${prefix}NoiseCentred`, noise.output, float(`${prefix}NoiseHalf`, -0.5)); // -0.5..0.5
  const amount = multiply(`${prefix}LumpAmount`, centred, float(`${prefix}LumpSize`, lumpSize * 2));
  return multiply(`${prefix}LumpPush`, normals, amount); // a vector × a number: along the normal
}

// ---- Tiny wiring helpers: each makes one block, wires its inputs, and returns its output port ----

const TYPES = NodeGeometryBlockConnectionPointTypes;

// A GeometryInputBlock holding a fixed number (a "Float" input node in the editor).
function float(name, value) {
  const input = new GeometryInputBlock(name, TYPES.Float);
  input.value = value;
  return input.output;
}

// The same for a fixed vector (a "Vector3" input node).
function vector(name, x, y, z) {
  const input = new GeometryInputBlock(name, TYPES.Vector3);
  input.value = new Vector3(x, y, z);
  return input.output;
}

// A contextual GeometryInputBlock: a per-vertex value (Positions, Normals...) of the geometry being
// processed by the nearest SetPositions (or instancing) block downstream.
function contextual(name, source) {
  const input = new GeometryInputBlock(name);
  input.contextualValue = source;
  return input.output;
}

// MathBlock: left (op) right, for numbers or vectors. Note: BOTH sides must be wired (an unwired side
// makes the output null), so constants go in through float() blocks.
function math(name, operation, left, right) {
  const block = new MathBlock(name);
  block.operation = operation;
  left.connectTo(block.left);
  right.connectTo(block.right);
  return block.output;
}
const add = (name, left, right) => math(name, MathBlockOperations.Add, left, right);
const multiply = (name, left, right) => math(name, MathBlockOperations.Multiply, left, right);

function pow(name, value, power) {
  const block = new GeometryPowBlock(name);
  value.connectTo(block.value);
  power.connectTo(block.power);
  return block.output;
}

// GeometryTrigonometryBlock: one-input maths (sin, abs, 1 - x...).
function trig(name, operation, value) {
  const block = new GeometryTrigonometryBlock(name);
  block.operation = operation;
  value.connectTo(block.input);
  return block.output;
}

function clamp(name, value, minimum, maximum) {
  const block = new GeometryClampBlock(name);
  block.minimum = minimum;
  block.maximum = maximum;
  value.connectTo(block.value);
  return block.output;
}

// VectorConverterBlock, both ways: a vector into its x, y, z numbers...
function split(name, vector) {
  const converter = new VectorConverterBlock(name);
  vector.connectTo(converter.xyzIn);
  return { x: converter.xOut, y: converter.yOut, z: converter.zOut };
}

// ...and numbers into a vector (null leaves that input unwired: 0).
function join(name, x, y, z) {
  const converter = new VectorConverterBlock(name);
  x?.connectTo(converter.xIn);
  y?.connectTo(converter.yIn);
  z?.connectTo(converter.zIn);
  return converter.xyzOut;
}

// GeometryTransformBlock: scales, then rotates (x, y, z angles in radians), then moves a geometry.
// Inputs left unwired use their own `.value`, like the boxes you type numbers into in the editor.
function transform(name, geometry, { scaling, rotation, translation }) {
  const block = new GeometryTransformBlock(name);
  geometry.connectTo(block.value);
  if (scaling) block.scaling.value = scaling;
  if (rotation) block.rotation.value = rotation;
  if (translation) block.translation.value = translation;
  return block.output;
}

function setPositions(name, geometry, positions) {
  const block = new SetPositionsBlock(name);
  geometry.connectTo(block.geometry);
  positions.connectTo(block.positions);
  return block.output;
}

function merge(name, geometries) {
  const block = new MergeGeometryBlock(name);
  const inputs = [block.geometry0, block.geometry1, block.geometry2, block.geometry3, block.geometry4];
  geometries.forEach((geometry, i) => geometry.connectTo(inputs[i]));
  return block.output;
}

// The end of every graph: fresh normals, then the GeometryOutputBlock the graph builds toward.
function finish(graph, geometry) {
  const normals = new ComputeNormalsBlock(`${graph.name}Normals`);
  geometry.connectTo(normals.geometry);
  graph.outputBlock = new GeometryOutputBlock(`${graph.name}Output`);
  normals.output.connectTo(graph.outputBlock.geometry);
  return graph;
}
