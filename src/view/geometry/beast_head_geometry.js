import {
  CapsuleBlock,
  ComputeNormalsBlock,
  CylinderBlock,
  GeometryClampBlock,
  GeometryDistanceBlock,
  GeometryDotBlock,
  GeometryInputBlock,
  GeometryLerpBlock,
  GeometryOptimizeBlock,
  GeometryOutputBlock,
  GeometryPowBlock,
  GeometrySmoothStepBlock,
  GeometryTransformBlock,
  GeometryTrigonometryBlock,
  GeometryTrigonometryBlockOperations,
  InstantiateLinearBlock,
  InstantiateOnVerticesBlock,
  MapRangeBlock,
  MathBlock,
  MathBlockOperations,
  MergeGeometryBlock,
  NodeGeometry,
  NodeGeometryBlockConnectionPointTypes,
  NodeGeometryContextualSources,
  NoiseBlock,
  PointListBlock,
  SetPositionsBlock,
  Vector3,
  VectorConverterBlock,
} from "@babylonjs/core";

// Fiendfyre's beast head, sculpted with Node Geometry: the code version of the Node Geometry Editor
// (nge.babylonjs.com). A NodeGeometry is a graph of blocks, like a NodeMaterial, but it runs once on
// the CPU and makes a mesh instead of a shader:
//   source blocks make simple shapes (capsule, cylinder, a list of points);
//   Set Positions moves every vertex of a shape: its `positions` input is a little formula made of
//     maths blocks, worked out once per vertex. Inside it, a contextual input block "Positions" (or
//     "Normals") gives the vertex being worked on, like a loop variable;
//   Instantiate blocks copy a shape many times (along a line, onto points...);
//   Merge joins shapes, Compute Normals works out the shading, and the Output block ends the graph.
// geometry.build() runs the graph; geometry.createMesh() turns the result into a Mesh.
// The graphs are returned too: graph.edit() opens one in the Node Geometry Editor (it needs the
// editor's script, so do that in a test page), and graph.serialize() gives JSON it can load.
//
// Units are metres; y is up, +z is forward (where the snout points), the jaw hinge is at the origin.
// The view scales the head up and wraps it in fire.

// ---- The head's measurements ----

// A profile: a size that changes smoothly from the back of a jaw to its front. It starts at `start`,
// and each step [from, to, by] changes it by `by` between z = from and z = to, easing in and out (a
// smoothstep). The same data builds the graphs (as blocks) and places the teeth (in plain JavaScript),
// so the teeth always follow the jaws' outline.
const profile = (start, ...steps) => ({ start, steps });

// Each jaw is a capsule pushed into shape, ring by ring (see sculptedBody):
//   back, front: where it starts and ends along z;
//   halfWidth: half its width; its widest points (the rim, at y = 0) are where the teeth grow;
//   top: how high the upper surface rises above the rim; bottom: how far the underside reaches
//     below it (both must stay above 0, or the surface would turn inside out);
//   lift: the middle of the jaw is raised this much (negative: lowered), fading to 0 at the rims:
//     the palate arches up into the skull, the floor of the lower jaw's mouth sags;
//   squareness: 1 = round cross-sections, smaller = boxier (a flat top, steep sides);
//   brushes: sculpting strokes (see brushStrength), written for the right side only (x ≥ 0): the
//     graph mirrors them, so each one sculpts both sides;
//   lumps: noise all over the surface: `size` is the size of a lump, `depth` how far it can push;
//   rings, sides: how much detail (rings along the length, vertices around each ring).
const UPPER_JAW = {
  back: -0.85,
  front: 2.0,
  halfWidth: profile(0.56, [-0.4, 0.9, -0.19], [1.0, 2.1, -0.09]),
  // A high cranium and forehead, a steep drop in front of the eyes, then a long, low snout.
  top: profile(0.72, [-0.4, 0.9, -0.18], [0.95, 1.4, -0.24], [1.4, 2.0, -0.06]),
  bottom: profile(0.02, [0.05, -0.6, 0.2]), // behind the hinge, the back of the skull hangs lower
  lift: 0.07, // the palate's middle is 5 cm above the rims (0.07 − 0.02)
  squareness: 0.6,
  rings: 26,
  sides: 40,
  brushes: [
    { from: [0.1, 0.52, 1.12], to: [0.38, 0.48, 0.9], radius: 0.15, push: [0.06, 0.2] }, // brow ridge, heaviest outside
    { at: [0, 0.52, 1.1], radius: 0.12, push: -0.06 }, // the frown between the brows
    { at: [0.3, 0.4, 1.13], radius: 0.11, push: -0.07 }, // the eye socket under the brow
    { at: [0.45, 0.14, 0.6], radius: 0.3, push: 0.1 }, // cheekbone
    { at: [0.52, 0.42, -0.2], radius: 0.32, push: 0.06 }, // jaw muscle on the side of the skull
    { from: [0, 0.62, 0.75], to: [0, 0.84, -0.35], radius: 0.14, push: [0.03, 0.07] }, // crest along the top
    { from: [0, 0.38, 1.45], to: [0.2, 0.32, 1.4], radius: 0.045, push: [0.035, 0.02] }, // snarl wrinkles across the nose
    { from: [0, 0.36, 1.62], to: [0.2, 0.3, 1.58], radius: 0.045, push: [0.035, 0.02] },
    { at: [0, 0.35, 1.88], radius: 0.12, push: 0.05 }, // the tip of the nose...
    { at: [0.14, 0.3, 1.92], radius: 0.08, push: 0.05 }, // ...and its flared nostrils
    { at: [0.31, 0.02, 1.56], radius: 0.13, push: 0.04 }, // the lip bulges over the fang's root
  ],
  lumps: { size: 0.28, depth: 0.07 },
};

const LOWER_JAW = {
  back: -0.2,
  front: 1.75,
  halfWidth: profile(0.43, [-0.1, 1.2, -0.13], [1.2, 1.9, -0.06]),
  top: profile(0.02),
  bottom: profile(0.27, [0.1, 1.6, -0.1]),
  lift: -0.08, // the floor of the mouth sags 6 cm between the rims (−0.08 + 0.02)
  squareness: 0.65,
  rings: 16,
  sides: 28,
  brushes: [
    { at: [0, -0.3, 1.5], radius: 0.2, push: 0.06 }, // chin
    { at: [0.38, -0.26, 0.05], radius: 0.22, push: 0.05 }, // the angle of the jaw
  ],
  lumps: { size: 0.28, depth: 0.06 },
};

// Horns, from the back of the cranium: `at` is the root (right side; the left one is its mirror
// image), the horn leans back by `pitch` and out by `yaw` (radians), and its tip curls up by `curl`.
const HORNS = [
  { at: [0.3, 0.66, -0.35], pitch: -1.3, yaw: -0.4, length: 1.05, width: 0.3, curl: 0.55 }, // the great pair
  { at: [0.5, 0.32, -0.25], pitch: -1.45, yaw: -0.7, length: 0.55, width: 0.2, curl: 0.2 }, // a smaller pair lower down
];

// A row of spikes along the top: `count` cones, the first at `at`, each next one `step` further
// (back and up the skull) and `grow` times bigger, all leaning back by `lean` radians.
const SPIKES = { at: [0, 0.62, 0.75], step: [0, 0.04, -0.2], count: 6, grow: 0.15, length: 0.18, width: 0.09, lean: -0.7 };

// Teeth. The fangs are at `fang.at` ([x, z], right side; mirrored); a row of smaller teeth runs along
// each rim from z = row.from to row.to, `inset` inside the rim, growing from `shortest` to `longest`
// toward the front; `front` teeth fill the front of the jaw, between the fangs. `width` is a tooth's
// base as a share of its length; `bend`: how far its tip curves back, as a share of its length. The
// roots sit `root` metres inside the jaw, so no gap shows.
const UPPER_TEETH = {
  pointsDown: true,
  rim: UPPER_JAW.halfWidth,
  root: 0.06,
  fang: { at: [0.3, 1.58], length: 0.48, width: 0.3, bend: 0.12 },
  row: { from: 0.5, to: 1.42, count: 6, shortest: 0.15, longest: 0.25, width: 0.42, bend: 0.1, inset: 0.04 },
  front: { at: [[0.22, 1.79], [0.14, 1.89], [0.05, 1.93]], length: 0.17, width: 0.4, bend: 0.1 },
  splay: 0.12, // radians each tooth leans outward
};

const LOWER_TEETH = {
  pointsDown: false,
  rim: LOWER_JAW.halfWidth,
  root: 0.06,
  fang: { at: [0.25, 1.45], length: 0.36, width: 0.32, bend: 0.1 },
  row: { from: 0.5, to: 1.3, count: 5, shortest: 0.13, longest: 0.21, width: 0.42, bend: 0.08, inset: 0.04 },
  front: { at: [[0.19, 1.6], [0.11, 1.66], [0.04, 1.69]], length: 0.14, width: 0.4, bend: 0.08 },
  splay: 0.1,
};

// Where the caller puts the glowing eyes: in the sockets, under the brows, on the surface.
const EYES = [new Vector3(-0.3, 0.33, 1.12), new Vector3(0.3, 0.33, 1.12)];

// ---- Building it ----

// The four pieces as template meshes (hidden, no material: the caller clones them), the graphs that
// made them, and where the eyes go.
export function createBeastHeadGeometry(scene) {
  const graphs = {
    upperJaw: graph("beastUpperJaw", upperJaw()),
    lowerJaw: graph("beastLowerJaw", sculptedBody(LOWER_JAW)),
    upperTeeth: graph("beastUpperTeeth", teeth(UPPER_TEETH)),
    lowerTeeth: graph("beastLowerTeeth", teeth(LOWER_TEETH)),
  };
  const meshes = {};
  for (const [name, geometry] of Object.entries(graphs)) {
    geometry.build(); // runs the graph: geometry.buildExecutionTime says how long it took (ms)
    const mesh = geometry.createMesh(geometry.name, scene);
    mesh.isVisible = false;
    meshes[name] = mesh;
  }
  return { meshes, graphs, eyes: EYES.map((eye) => eye.clone()) };
}

// A NodeGeometry whose result is `shape` (with its normals worked out).
function graph(name, shape) {
  const geometry = new NodeGeometry(name);
  const output = new GeometryOutputBlock("output");
  computeNormals(shape).connectTo(output.geometry);
  geometry.outputBlock = output; // build() follows the wires back from here
  return geometry;
}

// The skull and upper jaw: the sculpted body, with horns and a row of spikes stuck into it.
function upperJaw() {
  const horns = [];
  for (const side of [1, -1]) {
    for (const horn of HORNS) horns.push(hornShape(horn, side));
  }
  return merge([sculptedBody(UPPER_JAW), ...horns, spikeRow()]);
}

// One jaw: a capsule (a closed tube with round ends) pushed into shape. Its rings are spread from
// `back` to `front`, each one squashed into that point's cross-section; then brushes and noise sculpt
// the surface. It stays one closed surface: nothing is cut or added, the vertices only move.
function sculptedBody(jaw) {
  // Capsule block: radius 1 and 10 long, so its ends are rounded over a tenth of its length each.
  // It stands along y: the Transform block lays it along z (pitch a quarter turn).
  const capsule = new CapsuleBlock("capsule");
  capsule.radius.value = 1;
  capsule.height.value = 10;
  capsule.tessellation.value = jaw.sides;
  capsule.subdivisions.value = jaw.rings;
  let body = transform(capsule.geometry, { rotation: [Math.PI / 2, 0, 0] });
  // A capsule has a seam (a column of doubled vertices where its edges meet) and a fan of doubled
  // vertices at each tip. The Optimize block welds vertices that sit at the same spot, so the surface
  // can't tear open there when the noise moves them (`optimizeFaces` drops the triangles that
  // shrank to nothing). It also drops the normals: Compute Normals makes new ones below.
  const weld = new GeometryOptimizeBlock("weld");
  weld.optimizeFaces = true;
  body.connectTo(weld.geometry);
  body = weld.output;

  // 1. The shape. On the capsule, x and y run from -1 to 1 around the axis, z from -5 to 5.
  {
    const { x, y, z } = split(position());
    const along = mapRange(z, -5, 5, jaw.back, jaw.front); // the new z, in metres
    // A "superellipse": sign(v) × |v|^squareness pushes round cross-sections toward squares.
    const sx = superellipse(x, jaw.squareness);
    const sy = superellipse(y, jaw.squareness);
    const newX = mul(sx, profileBlocks(jaw.halfWidth, along));
    // The upper half (sy > 0) is scaled by `top`, the lower half (sy < 0) by `bottom`, so the rim,
    // where they meet, stays at y = 0. Then the middle is lifted by lift × (1 − sx²): all of it in
    // the middle (sx = 0), none at the rims (sx = ±1).
    const halves = add(mul(max(sy, 0), profileBlocks(jaw.top, along)), mul(min(sy, 0), profileBlocks(jaw.bottom, along)));
    const newY = add(halves, mul(sub(1, mul(sx, sx)), jaw.lift));
    body = setPositions(body, join(newX, newY, along));
  }
  body = computeNormals(body); // brushes push along the normals: they must match the new shape

  // 2. The sculpting: each vertex moves along its normal (out, or in if negative) by the sum of
  // every brush's push plus some noise.
  {
    const p = position();
    const { x, y, z } = split(p);
    const mirrored = join(abs(x), y, z); // brushes measure from here: both sides at once
    // Noise block: smooth random lumps (Perlin noise), from 0 to 1 (0.5 on average), of the vertex's
    // position. Its `scale` is how many lumps fit in a metre.
    const lumps = mul(sub(noise(1 / jaw.lumps.size, 3), 0.5), jaw.lumps.depth * 2);
    let push = lumps;
    for (const brush of jaw.brushes) push = add(push, brushStrength(brush, mirrored));
    body = setPositions(body, add(p, mul(normal(), push)));
  }
  return body;
}

// How far a brush pushes the vertex at `p`: its full `push` near it, fading smoothly to 0 at
// `radius`. A brush is a point (`at`) or a stroke (`from` → `to`, its push going from push[0] to
// push[1] along it).
function brushStrength(brush, p) {
  const fade = (distance) => smoothstep(distance, brush.radius, 0); // 1 at the brush, 0 at radius
  if (brush.at) {
    return mul(fade(distance(p, vector(brush.at))), brush.push);
  }
  // A stroke: find the nearest point of the segment from → to. t is how far along it (0 to 1):
  // t = (p − from)·(to − from) / |to − from|², kept between 0 and 1.
  const from = Vector3.FromArray(brush.from);
  const along = Vector3.FromArray(brush.to).subtract(from);
  const t = clamp(div(dot(sub(p, vector(from)), vector(along)), along.lengthSquared()), 0, 1);
  const nearest = add(vector(from), mul(vector(along), t));
  return mul(fade(distance(p, nearest)), lerp(brush.push[0], brush.push[1], t));
}

// A horn: a cone curled up at the tip, leaned back and out, its root stuck into the skull.
function hornShape(horn, side) {
  const shape = curvedCone({ length: horn.length, width: horn.width, curl: horn.curl, sides: 8, rings: 6 });
  const [x, y, z] = horn.at;
  return transform(shape, { rotation: [horn.pitch, horn.yaw * side, 0], translation: [x * side, y, z] });
}

// Spikes along the top of the head: Instantiate Linear copies one spike `count` times, each copy
// moved by `direction` and scaled up by `scaling` more than the one before.
function spikeRow() {
  const spike = transform(curvedCone({ length: SPIKES.length, width: SPIKES.width, curl: 0, sides: 6, rings: 1 }), {
    rotation: [SPIKES.lean, 0, 0],
  });
  const row = new InstantiateLinearBlock("spikes");
  spike.connectTo(row.instance);
  row.count.value = SPIKES.count;
  row.direction.value = Vector3.FromArray(SPIKES.step);
  row.scaling.value = new Vector3(SPIKES.grow, SPIKES.grow, SPIKES.grow);
  return transform(row.output, { translation: SPIKES.at });
}

// A cone standing on its base at the origin, pointing up (+y), whose tip curls toward +z: each
// vertex slides forward by curl × (height / length)², so the tip moves most.
function curvedCone({ length, width, curl, sides, rings }) {
  // Cylinder block: a top diameter of 0 makes it a cone. It's centred on the origin: move it up.
  const cylinder = new CylinderBlock("cone");
  cylinder.height.value = length;
  cylinder.diameterBottom.value = width;
  cylinder.diameterTop.value = 0;
  cylinder.tessellation.value = sides;
  cylinder.subdivisions.value = rings;
  const cone = transform(cylinder.geometry, { translation: [0, length / 2, 0] });
  if (curl === 0) {
    return cone;
  }
  const { x, y, z } = split(position());
  const height = div(y, length); // 0 at the base, 1 at the tip
  return setPositions(cone, join(x, y, add(z, mul(mul(height, height), curl))));
}

// All the teeth of one jaw, merged: two fangs, a row along each rim and a few at the front.
function teeth(set) {
  const mirror = (points) => points.flatMap(([x, z]) => [[x, z], [-x, z]]);
  // The rows' roots, from the jaw's own profile (in plain JavaScript): just inside the rim.
  const { row } = set;
  const rowPoints = [];
  for (let i = 0; i < row.count; i++) {
    const z = row.from + ((row.to - row.from) * i) / (row.count - 1);
    rowPoints.push([profileAt(set.rim, z) - row.inset, z]);
  }
  // A row tooth's length depends on how far forward it is: the shortest at the back, the longest
  // at the front. `z` is the root being filled (contextual Positions, inside Instantiate On Vertices).
  const z = split(position()).z;
  const rowLength = lerp(row.shortest, row.longest, mapRange(z, row.from, row.to, 0, 1));
  return merge([
    teethOnPoints(set, set.fang, mirror([set.fang.at]), set.fang.length),
    teethOnPoints(set, row, mirror(rowPoints), rowLength),
    teethOnPoints(set, set.front, mirror(set.front.at), set.front.length),
  ]);
}

// One tooth copied onto every point: Point List makes a "geometry" that is only points, and
// Instantiate On Vertices puts a copy of the tooth on each of them. Its `scaling` and `rotation`
// inputs are worked out per point (contextual Positions = that point), so each tooth can differ.
function teethOnPoints(set, kind, points, length) {
  const list = new PointListBlock("roots");
  list.points = points.map(([x, z]) => new Vector3(x, set.pointsDown ? set.root : -set.root, z));
  // A tooth 1 m long (scaled to its length below), curving back toward the throat (-z).
  let tooth = curvedCone({ length: 1, width: kind.width, curl: -kind.bend, sides: 7, rings: 3 });
  if (set.pointsDown) {
    // Upside down for the upper jaw: half a turn about z keeps the tip curving back.
    tooth = transform(tooth, { rotation: [0, 0, Math.PI] });
  }
  const place = new InstantiateOnVerticesBlock("teeth");
  list.geometry.connectTo(place.geometry);
  tooth.connectTo(place.instance);
  // The roots sit inside the jaw: the tooth is that much longer, so it shows its full length.
  add(length, set.root).connectTo(place.scaling); // a number scales all three axes alike
  // Lean each tooth outward: a roll about z, one way on the right (x > 0), the other on the left.
  const lean = mul(sign(split(position()).x), set.pointsDown ? set.splay : -set.splay);
  join(0, 0, lean).connectTo(place.rotation);
  return place.output;
}

// ---- Graph shorthands ----
// Each makes one block (or a few), wires its inputs and returns its output, so a graph reads like
// a formula: add(a, mul(b, 2)). Inputs can be another block's output, or a plain number or [x, y, z]
// (turned into a constant input block).

const Types = NodeGeometryBlockConnectionPointTypes;

// A constant: an input block holding a number or a Vector3.
function constant(value) {
  const isVector = value instanceof Vector3 || Array.isArray(value);
  const block = new GeometryInputBlock("constant", isVector ? Types.Vector3 : Types.Float);
  block.value = Array.isArray(value) ? Vector3.FromArray(value) : value;
  return block.output;
}
const constantOr = (value) => (typeof value === "number" || Array.isArray(value) || value instanceof Vector3 ? constant(value) : value);
const vector = (value) => constant(value);

// Contextual inputs: the vertex (or point) currently being worked on.
function contextual(name, source) {
  const block = new GeometryInputBlock(name);
  block.contextualValue = source;
  return block.output;
}
const position = () => contextual("position", NodeGeometryContextualSources.Positions);
const normal = () => contextual("normal", NodeGeometryContextualSources.Normals);

// Math block: + − × ÷ max min, on numbers or vectors (a number with a vector works on each part).
function math(operation, left, right) {
  const block = new MathBlock("math");
  block.operation = operation;
  constantOr(left).connectTo(block.left);
  constantOr(right).connectTo(block.right);
  return block.output;
}
const add = (a, b) => math(MathBlockOperations.Add, a, b);
const sub = (a, b) => math(MathBlockOperations.Subtract, a, b);
const mul = (a, b) => math(MathBlockOperations.Multiply, a, b);
const div = (a, b) => math(MathBlockOperations.Divide, a, b);
const max = (a, b) => math(MathBlockOperations.Max, a, b);
const min = (a, b) => math(MathBlockOperations.Min, a, b);

// Trigonometry block: despite its name it also does abs, sign, negate...
function trig(operation, value) {
  const block = new GeometryTrigonometryBlock("trig");
  block.operation = operation;
  constantOr(value).connectTo(block.input);
  return block.output;
}
const abs = (value) => trig(GeometryTrigonometryBlockOperations.Abs, value);
const sign = (value) => trig(GeometryTrigonometryBlockOperations.Sign, value);

function pow(value, power) {
  const block = new GeometryPowBlock("pow");
  constantOr(value).connectTo(block.value);
  constantOr(power).connectTo(block.power);
  return block.output;
}
const superellipse = (value, power) => mul(sign(value), pow(abs(value), power));

// Smoothstep: 0 below edge0, 1 above edge1, easing in between (edge0 > edge1 turns it around).
function smoothstep(value, edge0, edge1) {
  const block = new GeometrySmoothStepBlock("smoothstep");
  constantOr(value).connectTo(block.value);
  block.edge0.value = edge0; // an input left unwired uses its own value
  block.edge1.value = edge1;
  return block.output;
}

// Map Range: value's place between fromMin and fromMax, moved onto toMin..toMax (not clamped).
function mapRange(value, fromMin, fromMax, toMin, toMax) {
  const block = new MapRangeBlock("mapRange");
  constantOr(value).connectTo(block.value);
  block.fromMin.value = fromMin;
  block.fromMax.value = fromMax;
  block.toMin.value = toMin;
  block.toMax.value = toMax;
  return block.output;
}

function clamp(value, minimum, maximum) {
  const block = new GeometryClampBlock("clamp");
  constantOr(value).connectTo(block.value);
  block.minimum = minimum; // the Clamp block reads these properties when min/max aren't wired
  block.maximum = maximum;
  return block.output;
}

function lerp(left, right, gradient) {
  const block = new GeometryLerpBlock("lerp");
  constantOr(left).connectTo(block.left);
  constantOr(right).connectTo(block.right);
  constantOr(gradient).connectTo(block.gradient);
  return block.output;
}

function distance(a, b) {
  const block = new GeometryDistanceBlock("distance");
  constantOr(a).connectTo(block.left);
  constantOr(b).connectTo(block.right);
  return block.output;
}

function dot(a, b) {
  const block = new GeometryDotBlock("dot");
  constantOr(a).connectTo(block.left);
  constantOr(b).connectTo(block.right);
  return block.output;
}

// Noise block: Perlin noise of the current vertex's position, 0 to 1.
function noise(scale, octaves) {
  const block = new NoiseBlock("noise");
  block.scale.value = scale;
  block.octaves.value = octaves;
  return block.output;
}

// Vector Converter block: a vector into its x, y, z, or three numbers into a vector.
function split(value) {
  const block = new VectorConverterBlock("split");
  constantOr(value).connectTo(block.xyzIn);
  return { x: block.xOut, y: block.yOut, z: block.zOut };
}
function join(x, y, z) {
  const block = new VectorConverterBlock("join");
  constantOr(x).connectTo(block.xIn);
  constantOr(y).connectTo(block.yIn);
  constantOr(z).connectTo(block.zIn);
  return block.xyzOut;
}

// A profile (see the top of the file) as blocks: start + Σ by × smoothstep(from, to, z).
function profileBlocks({ start, steps }, z) {
  let value = constant(start);
  for (const [from, to, by] of steps) value = add(value, mul(smoothstep(z, from, to), by));
  return value;
}
// ...and in plain JavaScript.
function profileAt({ start, steps }, z) {
  let value = start;
  for (const [from, to, by] of steps) {
    const t = Math.min(1, Math.max(0, (z - from) / (to - from)));
    value += by * t * t * (3 - 2 * t);
  }
  return value;
}

// Geometry blocks.

// Transform block: scale, then rotate (x = pitch, y = yaw, z = roll, radians), then move.
function transform(geometry, { translation = [0, 0, 0], rotation = [0, 0, 0] }) {
  const block = new GeometryTransformBlock("transform");
  geometry.connectTo(block.value);
  block.translation.value = Vector3.FromArray(translation);
  block.rotation.value = Vector3.FromArray(rotation);
  return block.output;
}

// Set Positions block: every vertex of `geometry` moves to `positions` (worked out per vertex).
function setPositions(geometry, positions) {
  const block = new SetPositionsBlock("setPositions");
  geometry.connectTo(block.geometry);
  positions.connectTo(block.positions);
  return block.output;
}

function computeNormals(geometry) {
  const block = new ComputeNormalsBlock("normals");
  geometry.connectTo(block.geometry);
  return block.output;
}

// Merge Geometry block: up to 5 shapes into one; more are merged in groups of 5.
function merge(shapes) {
  if (shapes.length === 1) {
    return shapes[0];
  }
  const groups = [];
  for (let i = 0; i < shapes.length; i += 5) {
    const block = new MergeGeometryBlock("merge");
    const inputs = [block.geometry0, block.geometry1, block.geometry2, block.geometry3, block.geometry4];
    shapes.slice(i, i + 5).forEach((shape, k) => shape.connectTo(inputs[k]));
    groups.push(block.output);
  }
  return merge(groups);
}
