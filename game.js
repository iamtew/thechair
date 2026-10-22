import * as THREE from 'three';
import { Application, Graphics, Text, Container } from 'pixi.js';

// Night apartment, first person.
// Three.js draws the rooms. PixiJS draws the crosshair, prompts, note, and touch stick.
// Walls are boxes. The player is a circle on the floor, pushed out of those boxes.
//
// Floor plan (meters). Player spawns in the entrance, looking +z.
//
//   x 0        2.55       6.05      8.2        10.2
// z 13  +-----------------+
//       | bedroom         |
// z 10  |                 +---------+
//       |                 | bath    |
// z 8.3 +------+----------+----+----+
//       |      | living        | wc |
// z 6.6 |      |          +----+----+
//       | hall |          | kitchen |
// z 3.3 +------+----------+---------+
//       | entrance |
// z 0   +----------+

const NOTE = [
  'The day can stay outside.',
  'The chair will take the weight.',
  '',
  'The lighter still works.',
  "You don't have to finish it.",
].join('\n');

const PLAYER_R = 0.28;
const STAND_Y = 1.62;
const EYE_SIT = 1.02;
const USE_REACH = 2.5;
const WALK = 2.35;

const T = 0.16;
const H = 2.6;
const X_MID = 2.55;
const X_SPLIT = 6.05;
const X_WC = 8.2;
const X_E = 10.2;
const Z_ENTRY = 3.25;
const Z_KITCHEN = 6.55;
const Z_BED = 8.25;
const Z_WC = 8.35;
const Z_BATH = 10.05;
const Z_N = 13.05;

// Chair sits past the foot of the bed, turned so the sitter looks at the mattress.
const BED = { x: 2.85, z: 11.55 };
const CHAIR = { x: 4.15, z: 9.4 };
const toBedX = BED.x - CHAIR.x;
const toBedZ = BED.z - CHAIR.z;
// Group local +z becomes (sin θ, cos θ). That θ aims the backrest away from the bed.
const CHAIR_TURN = Math.atan2(toBedX, toBedZ);
// Camera yaw PI looks +z. This is the same aim, in that convention.
const SIT_YAW = Math.atan2(-toBedX, -toBedZ);
const sitLookX = -Math.sin(SIT_YAW);
const sitLookZ = -Math.cos(SIT_YAW);
const SEAT = {
  x: CHAIR.x + sitLookX * 0.08,
  y: EYE_SIT,
  z: CHAIR.z + sitLookZ * 0.08,
};
// Stand just west of the chair, in the open aisle. Same spot the lerp returns to.
const STAND_SPOT = { x: CHAIR.x - 1.05, y: STAND_Y, z: CHAIR.z };

const solids = [];
let mode = 'walk';
let boxOpen = false;
let noteOpen = false;
let lidHinge = null;
let currentHit = null;

const player = { x: 1.25, y: STAND_Y, z: 0.95 };
let yaw = Math.PI;
let pitch = 0;
let blend = 0;
let fromPose = { x: 0, y: 0, z: 0 };
let toPose = { x: 0, y: 0, z: 0 };
let fromYaw = 0;
let fromPitch = 0;

const down = {};
let movePtr = null;
let lookPtr = null;
const touch = matchMedia('(pointer: coarse)').matches;

const center = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

let renderer;
let scene;
let camera;
let prompt;
let cross;
let stickG;
let useBtn;
let noteWrap;
let noteBg;
let noteText;

function overlaps(x, z, list, r) {
  for (const s of list) {
    if (x + r > s.minX && x - r < s.maxX && z + r > s.minZ && z - r < s.maxZ) return true;
  }
  return false;
}

// The walk check. One rectangle in, one circle. Fails in the browser console if the test is wrong.
function selfCheck() {
  const list = [{ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }];
  if (!overlaps(0.5, 0.5, list, PLAYER_R)) throw new Error('center should hit');
  if (overlaps(2, 2, list, PLAYER_R)) throw new Error('far should miss');
  if (!overlaps(1.1, 0.5, list, PLAYER_R)) throw new Error('radius should hit');
  if (overlaps(-0.5, 0.5, list, PLAYER_R)) throw new Error('far side should miss');
}

function blocked(x, z) {
  const r = PLAYER_R;
  for (const s of solids) {
    // The cushion is inside the chair box. Ignore it while sitting down.
    if (s.id === 'chair' && mode !== 'walk') continue;
    if (x + r > s.minX && x - r < s.maxX && z + r > s.minZ && z - r < s.maxZ) return true;
  }
  return false;
}

function tryMove(dx, dz) {
  const nx = player.x + dx;
  const nz = player.z + dz;
  if (!blocked(nx, nz)) {
    player.x = nx;
    player.z = nz;
  }
}

function paintTexture(draw, rx, ry) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  draw(c.getContext('2d'), 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.anisotropy = 4;
  return tex;
}

function tag(mesh, kind, name) {
  mesh.userData.kind = kind;
  if (name) mesh.userData.name = name;
  return mesh;
}

function bootThree() {
  const canvas = document.getElementById('view');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x161310);
  scene.fog = new THREE.Fog(0x161310, 5, 18);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.06, 40);
  camera.rotation.order = 'YXZ';
}

function buildWorld() {
  const woodTex = paintTexture((g, n) => {
    g.fillStyle = '#6b4630';
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 28; i++) {
      g.strokeStyle = `rgba(32,16,8,${0.08 + (i % 5) * 0.035})`;
      g.lineWidth = 1 + (i % 3);
      g.beginPath();
      const y = (i * 9) % n;
      g.moveTo(0, y);
      g.bezierCurveTo(n * 0.3, y + 6, n * 0.6, y - 4, n, y + 2);
      g.stroke();
    }
  }, 3, 3);

  const plasterTex = paintTexture((g, n) => {
    g.fillStyle = '#d4ccc0';
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 700; i++) {
      const v = 170 + ((i * 47) % 55);
      g.fillStyle = `rgba(${v},${v - 6},${v - 14},0.16)`;
      g.fillRect((i * 13) % n, (i * 29) % n, 2, 2);
    }
  }, 2, 2);

  const tileTex = paintTexture((g, n) => {
    g.fillStyle = '#c5ccc9';
    g.fillRect(0, 0, n, n);
    g.strokeStyle = '#a7b0ad';
    g.lineWidth = 4;
    for (let i = 0; i <= 4; i++) {
      const p = (i * n) / 4;
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, n);
      g.moveTo(0, p);
      g.lineTo(n, p);
      g.stroke();
    }
  }, 2, 2);

  const wallMat = new THREE.MeshStandardMaterial({ map: plasterTex, roughness: 0.95 });
  const floorMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.84 });
  const tileMat = new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.55 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xb7b0a6, roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3022, roughness: 0.55 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x2c1d14, roughness: 0.6 });
  const counterMat = new THREE.MeshStandardMaterial({ color: 0x8d8a86, roughness: 0.4 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x4a2420, roughness: 0.52, metalness: 0.06 });
  const buttonMat = new THREE.MeshStandardMaterial({ color: 0x2a1210, roughness: 0.4, metalness: 0.2 });
  const sheet = new THREE.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.9 });
  const duvet = new THREE.MeshStandardMaterial({ color: 0x1c2430, roughness: 0.85 });
  const sofaMat = new THREE.MeshStandardMaterial({ color: 0x2c2a32, roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc5c8cc, roughness: 0.25, metalness: 0.85 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a3b, roughness: 0.35, metalness: 0.65 });
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xf0d2a8,
    emissive: 0xffb060,
    emissiveIntensity: 0.7,
    roughness: 0.75,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9bb4c8,
    emissive: 0x6d88a4,
    emissiveIntensity: 0.85,
    roughness: 0.12,
    metalness: 0.05,
  });
  const paper = new THREE.MeshStandardMaterial({ color: 0xf3ead7, roughness: 0.9 });
  const packMat = new THREE.MeshStandardMaterial({ color: 0xf4f0e8, roughness: 0.6 });
  const packRed = new THREE.MeshStandardMaterial({ color: 0x8e2a2a, roughness: 0.5 });
  const ashMat = new THREE.MeshStandardMaterial({ color: 0x8d9498, roughness: 0.25, metalness: 0.15 });
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xe7e4df, roughness: 0.35 });
  const fridgeMat = new THREE.MeshStandardMaterial({ color: 0xd5d8d4, roughness: 0.35, metalness: 0.1 });

  function addWall(x0, z0, x1, z1, y0 = 0, y1 = H, mat = wallMat) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minZ = Math.min(z0, z1);
    const maxZ = Math.max(z0, z1);
    const h = y1 - y0;
    if (maxX - minX < 0.01 || maxZ - minZ < 0.01 || h < 0.01) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, h, maxZ - minZ), mat);
    mesh.position.set((minX + maxX) / 2, y0 + h / 2, (minZ + maxZ) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    // Sills block the player. Headers above 2 m do not.
    if (y0 < 1) solids.push({ minX, maxX, minZ, maxZ });
  }

  function addBlock(w, h, d, mat, x, y, z, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (solid) {
      solids.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
      });
    }
    return mesh;
  }

  function addFloor(x0, z0, x1, z1, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.04, z1 - z0), mat);
    mesh.position.set((x0 + x1) / 2, -0.02, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  function addCeil(x0, z0, x1, z1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.06, z1 - z0), ceilMat);
    mesh.position.set((x0 + x1) / 2, H + 0.03, (z0 + z1) / 2);
    scene.add(mesh);
  }

  function addWindow(x, y, z, w, h, alongX) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w : 0.02, h, alongX ? 0.02 : w), glass);
    pane.position.set(x, y, z);
    scene.add(pane);
    const frame = woodDark;
    const t = 0.05;
    if (alongX) {
      addBlock(w + t, t, 0.06, frame, x, y + h / 2, z, false);
      addBlock(w + t, t, 0.06, frame, x, y - h / 2, z, false);
      addBlock(t, h, 0.06, frame, x - w / 2, y, z, false);
      addBlock(t, h, 0.06, frame, x + w / 2, y, z, false);
    }
  }

  const slabs = [
    [0, 0, X_MID, Z_ENTRY, floorMat],
    [0, Z_ENTRY, X_SPLIT, Z_BED, floorMat],
    [X_SPLIT, Z_ENTRY, X_E, Z_KITCHEN, floorMat],
    [X_SPLIT, Z_KITCHEN, X_WC, Z_BATH, tileMat],
    [X_WC, Z_KITCHEN, X_E, Z_WC, tileMat],
    [0, Z_BED, X_SPLIT, Z_N, floorMat],
  ];
  for (const [x0, z0, x1, z1, mat] of slabs) {
    addFloor(x0, z0, x1, z1, mat);
    addCeil(x0, z0, x1, z1);
  }

  // Shell and door gaps. Numbers match the comment at the top of the file.
  addWall(0, 0, T, Z_N);
  addWall(0, 0, X_MID, T);
  addWall(X_MID - T, 0, X_MID, Z_ENTRY);
  addWall(X_MID - T, Z_ENTRY - T, 4.15, Z_ENTRY);
  addWall(5.7, Z_ENTRY - T, X_E, Z_ENTRY);
  addWall(4.15, Z_ENTRY - T, 5.7, Z_ENTRY, 0, 0.95);
  addWall(4.15, Z_ENTRY - T, 5.7, Z_ENTRY, 2.15, H);
  addWindow(4.92, 1.55, Z_ENTRY - T / 2, 1.4, 1.05, true);

  addWall(X_E - T, Z_ENTRY - T, X_E, Z_KITCHEN);
  addWall(X_SPLIT, Z_ENTRY, X_SPLIT + T, 3.4);
  addWall(X_SPLIT, 4.75, X_SPLIT + T, Z_KITCHEN, 0, 0.94, counterMat);
  addWall(X_SPLIT, Z_KITCHEN - T, X_E, Z_KITCHEN);

  addWall(X_SPLIT, Z_KITCHEN, X_SPLIT + T, 6.75);
  addWall(X_SPLIT, 7.95, X_SPLIT + T, Z_BED);
  addWall(X_SPLIT, 6.75, X_SPLIT + T, 7.95, 2.05, H);

  addWall(0, Z_BED - T, 0.5, Z_BED);
  addWall(2.2, Z_BED - T, X_SPLIT + T, Z_BED);
  addWall(0.5, Z_BED - T, 2.2, Z_BED, 2.05, H);

  addWall(X_SPLIT, Z_BED, X_SPLIT + T, Z_N);
  addWall(X_WC, Z_WC, X_WC + T, Z_BATH);
  addWall(X_SPLIT, Z_BATH - T, X_WC, Z_BATH);
  addWall(X_WC, Z_KITCHEN, X_WC + T, 6.85);
  addWall(X_WC, 7.95, X_WC + T, Z_WC);
  addWall(X_WC, 6.85, X_WC + T, 7.95, 2.05, H);
  addWall(X_WC, Z_WC - T, X_E, Z_WC);
  addWall(X_E - T, Z_KITCHEN, X_E, Z_WC);

  addWall(0, Z_N - T, 4.2, Z_N);
  addWall(5.7, Z_N - T, X_SPLIT + T, Z_N);
  addWall(4.2, Z_N - T, 5.7, Z_N, 0, 1.0);
  addWall(4.2, Z_N - T, 5.7, Z_N, 2.2, H);
  addWindow(4.95, 1.6, Z_N - T / 2, 1.35, 1.05, true);

  // Entrance door, the way in. Not a collider. The south wall already is.
  addBlock(0.92, 2.05, 0.04, woodDark, 1.25, 1.02, 0.1, false);

  // Living room, off the west aisle so a straight walk from the door still fits.
  tag(addBlock(0.9, 0.42, 2.1, sofaMat, 4.85, 0.21, 5.4), 'look', 'Sofa');
  addBlock(0.9, 0.32, 0.16, sofaMat, 5.22, 0.48, 5.4, false);
  tag(addBlock(0.7, 0.28, 1.1, wood, 3.85, 0.16, 5.4), 'look', 'Coffee table');

  // Kitchen. The low wall on x = X_SPLIT is the pass-through.
  tag(addBlock(1.0, 0.92, 2.6, counterMat, X_E - 0.7, 0.46, 4.85), 'look', 'Counter');
  tag(addBlock(0.55, 0.03, 0.55, woodDark, X_E - 0.85, 0.94, 4.3, false), 'look', 'Stove');
  addBlock(0.42, 0.5, 2.4, wood, X_E - 0.38, 1.85, 4.85, false);
  tag(addBlock(0.72, 1.7, 0.68, fridgeMat, X_SPLIT + 0.7, 0.85, 5.95), 'look', 'Fridge');

  // Bath and toilet. Fixtures are solid so you walk around them.
  tag(addBlock(0.5, 0.14, 0.4, counterMat, 7.55, 0.78, 7.25), 'look', 'Sink');
  addBlock(0.1, 0.78, 0.1, porcelain, 7.55, 0.39, 7.25, false);
  tag(addBlock(1.2, 0.48, 0.68, porcelain, 7.05, 0.24, 9.5), 'look', 'Bath');
  tag(addBlock(0.4, 0.4, 0.52, porcelain, 9.35, 0.22, 7.7), 'look', 'Toilet');
  addBlock(0.4, 0.45, 0.16, porcelain, 9.35, 0.55, 7.95, false);

  // Bedroom. West aisle (x about 1.25) stays open from the door to the back wall.
  tag(addBlock(1.6, 0.28, 2.1, woodDark, BED.x, 0.2, BED.z), 'look', 'Bed');
  addBlock(1.6, 0.55, 0.08, woodDark, BED.x, 0.7, BED.z + 1.02, false);
  addBlock(1.45, 0.18, 1.9, sheet, BED.x, 0.38, BED.z, false);
  addBlock(1.45, 0.1, 1.15, duvet, BED.x, 0.5, BED.z + 0.2, false);
  addBlock(0.62, 0.1, 0.36, sheet, BED.x - 0.32, 0.52, BED.z + 0.72, false);
  addBlock(0.62, 0.1, 0.36, sheet, BED.x + 0.32, 0.52, BED.z + 0.72, false);
  tag(addBlock(0.5, 1.9, 1.15, wood, 5.55, 0.95, 11.7), 'look', 'Wardrobe');

  buildChair(leather, buttonMat, woodDark);
  buildSideTable(wood, paper, packMat, packRed, ashMat, metal);
  buildLamp(brass, shadeMat);

  const moon = new THREE.DirectionalLight(0xb9c7db, 0.55);
  moon.position.set(4.9, 4, 14);
  scene.add(moon);

  scene.add(new THREE.HemisphereLight(0x8ea0bf, 0x3a2a22, 0.85));

  // The only shadow caster. Warm pool on the chair and the bed.
  const spot = new THREE.SpotLight(0xffb067, 90, 14, 0.85, 0.55, 1.4);
  spot.position.set(5.35, 1.72, 8.55);
  spot.target.position.set(BED.x, 0.7, BED.z);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0008;
  spot.shadow.normalBias = 0.02;
  spot.shadow.camera.near = 0.3;
  spot.shadow.camera.far = 12;
  scene.add(spot);
  scene.add(spot.target);

  const bulb = new THREE.PointLight(0xffb36a, 12, 4.5, 2);
  bulb.position.set(5.35, 1.45, 8.55);
  scene.add(bulb);

  // Path light. The bedroom lamp does not reach the entrance.
  const path = new THREE.PointLight(0xffe2c4, 18, 9, 2);
  path.position.set(3.4, 2.15, 5.2);
  scene.add(path);

  const bathLight = new THREE.PointLight(0xfff1dd, 14, 6, 2);
  bathLight.position.set(7.2, 2.2, 8.3);
  scene.add(bathLight);
}

function buildChair(leather, buttonMat, wood) {
  const g = new THREE.Group();
  g.position.set(CHAIR.x, 0, CHAIR.z);
  g.rotation.y = CHAIR_TURN;
  const button = new THREE.SphereGeometry(0.022, 8, 8);

  const rug = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.015, 1.35), leather);
  rug.position.y = 0.008;
  rug.receiveShadow = true;
  g.add(rug);

  function part(w, h, d, mat, x, y, z, geo) {
    const mesh = new THREE.Mesh(geo || new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.kind = 'chair';
    g.add(mesh);
  }

  // Back is local -z. The group turn points local +z at the bed.
  part(0.78, 0.16, 0.7, leather, 0, 0.46, 0.05);
  part(0.78, 0.58, 0.12, leather, 0, 0.78, -0.3);
  part(0.12, 0.28, 0.68, leather, -0.4, 0.62, 0.04);
  part(0.12, 0.28, 0.68, leather, 0.4, 0.62, 0.04);
  for (const [x, z] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.28], [0.3, 0.28]]) {
    part(0.06, 0.28, 0.06, wood, x, 0.14, z);
  }
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      part(0, 0, 0, buttonMat, -0.18 + col * 0.18, 0.66 + row * 0.22, -0.23, button);
    }
  }
  scene.add(g);
  // Standing eyes clear the back. This volume is what "look at the chair" hits.
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(0.96, 1.8, 0.95),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  proxy.position.set(0, 1, 0);
  proxy.userData.kind = 'chair';
  g.add(proxy);
  // Axis-aligned box around the turned chair. A bit fat so the corners still block.
  solids.push({
    id: 'chair',
    minX: CHAIR.x - 0.58,
    maxX: CHAIR.x + 0.58,
    minZ: CHAIR.z - 0.58,
    maxZ: CHAIR.z + 0.58,
  });
}

function buildSideTable(wood, paper, packMat, packRed, ashMat, metal) {
  const x = 5.15;
  const z = CHAIR.z;
  const top = 0.56;
  tag(addLoose(0.62, 0.04, 0.46, wood, x, top, z), 'look', 'Side table');
  for (const [dx, dz] of [[-0.24, -0.16], [0.24, -0.16], [-0.24, 0.16], [0.24, 0.16]]) {
    addLoose(0.05, top, 0.05, wood, x + dx, top / 2, z + dz);
  }
  solids.push({ minX: x - 0.31, maxX: x + 0.31, minZ: z - 0.23, maxZ: z + 0.23 });
  buildBox(x, z, wood, paper, packMat, packRed, ashMat, metal);
}

// addBlock always parents to the scene. The box parts need a group, so this is the loose mesh.
function addLoose(w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function buildBox(x, z, wood, paper, packMat, packRed, ashMat, metal) {
  const holder = new THREE.Group();
  holder.position.set(x, 0.58, z);
  scene.add(holder);

  function side(w, h, d, px, py, pz) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.kind = 'box';
    holder.add(mesh);
  }

  // Open box. No lid in this mesh, or the ray would never reach the note.
  side(0.36, 0.012, 0.26, 0, 0.006, 0);
  side(0.012, 0.07, 0.26, -0.174, 0.035, 0);
  side(0.012, 0.07, 0.26, 0.174, 0.035, 0);
  side(0.36, 0.07, 0.012, 0, 0.035, 0.124);
  side(0.36, 0.07, 0.012, 0, 0.035, -0.124);

  const note = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.008, 0.09), paper);
  note.position.set(-0.06, 0.02, 0.02);
  note.userData.kind = 'note';
  holder.add(note);

  const cig = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.05), packMat);
  cig.position.set(0.07, 0.032, -0.04);
  cig.userData.kind = 'look';
  cig.userData.name = 'Cigarettes';
  holder.add(cig);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.016, 0.052), packRed);
  band.position.set(0.07, 0.04, -0.04);
  band.userData.kind = 'look';
  band.userData.name = 'Cigarettes';
  holder.add(band);

  const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.03, 0.02, 16), ashMat);
  ash.position.set(0.08, 0.02, 0.05);
  ash.userData.kind = 'look';
  ash.userData.name = 'Ashtray';
  holder.add(ash);

  // On its side so it fits under the lid.
  const zippo = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.016, 0.03), metal);
  zippo.position.set(-0.02, 0.02, -0.05);
  zippo.userData.kind = 'look';
  zippo.userData.name = 'Zippo';
  holder.add(zippo);

  // Hinge on the north edge. Positive X rotation lifts the lid up and away.
  lidHinge = new THREE.Group();
  lidHinge.position.set(0, 0.07, 0.13);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.02, 0.28), wood);
  lid.position.set(0, 0.01, -0.14);
  lid.castShadow = true;
  lid.userData.kind = 'box';
  lidHinge.add(lid);
  holder.add(lidHinge);
}

function buildLamp(brass, shadeMat) {
  const x = 5.4;
  const z = 8.55;
  addLoose(0.14, 0.04, 0.14, brass, x, 0.02, z);
  tag(addLoose(0.04, 1.3, 0.04, brass, x, 0.68, z), 'look', 'Lamp');
  solids.push({ minX: x - 0.08, maxX: x + 0.08, minZ: z - 0.08, maxZ: z + 0.08 });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.16, 16, 1, true), shadeMat);
  shade.position.set(x, 1.4, z);
  shade.userData.kind = 'look';
  shade.userData.name = 'Lamp';
  scene.add(shade);
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  layoutHud();
}

function beginSit() {
  fromPose = { x: player.x, y: player.y, z: player.z };
  toPose = { x: SEAT.x, y: SEAT.y, z: SEAT.z };
  fromYaw = yaw;
  fromPitch = pitch;
  blend = 0;
  mode = 'toSit';
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function beginStand() {
  fromPose = { x: player.x, y: player.y, z: player.z };
  toPose = { x: STAND_SPOT.x, y: STAND_SPOT.y, z: STAND_SPOT.z };
  blend = 0;
  mode = 'toStand';
}

function hideNote() {
  noteOpen = false;
  if (noteWrap) noteWrap.visible = false;
}

function showNote() {
  noteOpen = true;
  noteWrap.visible = true;
  const b = noteText.getLocalBounds();
  noteBg.clear();
  noteBg.roundRect(b.x - 28, b.y - 24, b.width + 56, b.height + 48, 4).fill({ color: 0xf3ead7 });
}

function use() {
  if (noteOpen) {
    hideNote();
    return;
  }
  if (mode === 'toSit' || mode === 'toStand') return;
  const kind = currentHit?.object.userData.kind;
  if (kind === 'chair') {
    if (mode === 'walk') beginSit();
    else if (mode === 'sit') beginStand();
    return;
  }
  if (kind === 'box') {
    boxOpen = !boxOpen;
    return;
  }
  if (kind === 'note' && boxOpen) {
    showNote();
    return;
  }
  if (mode === 'sit') beginStand();
}

function lookAt() {
  raycaster.setFromCamera(center, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  currentHit = null;
  for (const hit of hits) {
    if (hit.distance > USE_REACH) break;
    const kind = hit.object.userData.kind;
    if (!kind) break;
    // Your own chair fills the lap. Don't let it hide the table.
    if (kind === 'chair' && mode !== 'walk') continue;
    if (kind === 'note' && !boxOpen) break;
    currentHit = hit;
    break;
  }
}

function labelFor() {
  if (noteOpen) return { text: 'Close', action: true };
  const hit = currentHit;
  if (!hit) {
    if (mode === 'sit') return { text: 'Stand', action: true };
    return { text: '', action: false };
  }
  const { kind, name } = hit.object.userData;
  if (kind === 'chair') return { text: mode === 'sit' ? 'Stand' : 'Sit', action: true };
  if (kind === 'box') return { text: boxOpen ? 'Close the box' : 'Open the box', action: true };
  if (kind === 'note') return { text: 'Read the note', action: true };
  if (kind === 'look') return { text: name || '', action: false };
  return { text: '', action: false };
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function update(dt) {
  let ix = 0;
  let iz = 0;
  if (down.KeyW || down.ArrowUp) iz += 1;
  if (down.KeyS || down.ArrowDown) iz -= 1;
  if (down.KeyD || down.ArrowRight) ix += 1;
  if (down.KeyA || down.ArrowLeft) ix -= 1;
  if (movePtr) {
    ix += clamp(movePtr.dx / 56, -1, 1);
    iz += clamp(-movePtr.dy / 56, -1, 1);
  }

  if (mode === 'walk') {
    const len = Math.hypot(ix, iz);
    if (len > 0) {
      camera.position.set(player.x, player.y, player.z);
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() > 0) forward.normalize();
      right.crossVectors(up, forward);
      const k = (WALK * dt) / len;
      tryMove((forward.x * iz + right.x * ix) * k, 0);
      tryMove(0, (forward.z * iz + right.z * ix) * k);
    }
    player.y = STAND_Y;
  } else if (mode === 'toSit' || mode === 'toStand') {
    blend += dt / 0.6;
    const k = smooth(Math.min(1, blend));
    player.x = fromPose.x + (toPose.x - fromPose.x) * k;
    player.y = fromPose.y + (toPose.y - fromPose.y) * k;
    player.z = fromPose.z + (toPose.z - fromPose.z) * k;
    if (mode === 'toSit') {
      yaw = lerpAngle(fromYaw, SIT_YAW, k);
      pitch = fromPitch * (1 - k);
    }
    if (blend >= 1) mode = mode === 'toSit' ? 'sit' : 'walk';
  }

  camera.position.set(player.x, player.y, player.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  if (lidHinge) {
    const target = boxOpen ? 2.15 : 0;
    lidHinge.rotation.x += (target - lidHinge.rotation.x) * Math.min(1, dt * 8);
  }

  lookAt();
  const label = labelFor();
  const locked = document.pointerLockElement === document.body;
  if (!label.text && !touch && !locked) prompt.text = 'Click to look around';
  else if (!label.text) prompt.text = '';
  else prompt.text = !touch && label.action ? `E   ${label.text}` : label.text;

  drawStick();
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function drawStick() {
  if (!stickG) return;
  stickG.clear();
  if (!touch && !movePtr) return;
  const baseX = movePtr ? movePtr.ox : 110;
  const baseY = movePtr ? movePtr.oy : window.innerHeight - 140;
  if (!movePtr && !touch) return;
  stickG.circle(baseX, baseY, 54).stroke({ width: 2, color: 0xf3efe6, alpha: movePtr ? 0.7 : 0.35 });
  const kx = baseX + (movePtr ? clamp(movePtr.dx, -46, 46) : 0);
  const ky = baseY + (movePtr ? clamp(movePtr.dy, -46, 46) : 0);
  stickG.circle(kx, ky, 22).fill({ color: 0xf3efe6, alpha: 0.45 });
}

function layoutHud() {
  if (!cross) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  cross.position.set(w / 2, h / 2);
  prompt.position.set(w / 2, h - (touch ? 156 : 40));
  useBtn.position.set(w / 2, h - 78);
  useBtn.visible = touch;
  noteWrap.position.set(w / 2, h / 2);
}

function overUse(e) {
  const dx = e.clientX - window.innerWidth / 2;
  const dy = e.clientY - (window.innerHeight - 78);
  return dx * dx + dy * dy < 46 * 46;
}

function bindInput() {
  window.addEventListener('keydown', (e) => {
    const was = down[e.code];
    down[e.code] = true;
    if (!was && e.code === 'KeyE') use();
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    down[e.code] = false;
  });
  window.addEventListener('blur', () => {
    for (const k of Object.keys(down)) down[k] = false;
    movePtr = null;
    lookPtr = null;
  });

  document.addEventListener('pointerlockchange', () => {
    document.body.classList.toggle('locked', document.pointerLockElement === document.body);
  });

  window.addEventListener('mousemove', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const locked = document.pointerLockElement === document.body;
    // Hold the button if the browser will not capture the pointer.
    if (!locked && e.buttons !== 1) return;
    yaw -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
    pitch = clamp(pitch, -1.15, 1.15);
  });

  window.addEventListener('pointerdown', (e) => {
    if (noteOpen) {
      hideNote();
      return;
    }
    if (e.pointerType === 'mouse') {
      if (document.pointerLockElement !== document.body) document.body.requestPointerLock();
      return;
    }
    if (overUse(e)) {
      use();
      return;
    }
    if (e.clientX < window.innerWidth * 0.42) {
      movePtr = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
    } else {
      lookPtr = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (movePtr && e.pointerId === movePtr.id) {
      movePtr.dx = e.clientX - movePtr.ox;
      movePtr.dy = e.clientY - movePtr.oy;
    }
    if (lookPtr && e.pointerId === lookPtr.id) {
      const dx = e.clientX - lookPtr.x;
      const dy = e.clientY - lookPtr.y;
      lookPtr.x = e.clientX;
      lookPtr.y = e.clientY;
      yaw -= dx * 0.005;
      pitch -= dy * 0.005;
      pitch = clamp(pitch, -1.15, 1.15);
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (movePtr && e.pointerId === movePtr.id) movePtr = null;
    if (lookPtr && e.pointerId === lookPtr.id) lookPtr = null;
  });
  window.addEventListener('pointercancel', (e) => {
    if (movePtr && e.pointerId === movePtr.id) movePtr = null;
    if (lookPtr && e.pointerId === lookPtr.id) lookPtr = null;
  });

  window.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
}

async function bootHud() {
  const app = new Application();
  await app.init({
    backgroundAlpha: 0,
    resizeTo: window,
    antialias: true,
    preference: 'webgl',
    resolution: Math.min(devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  document.getElementById('hud').appendChild(app.canvas);
  app.stage.eventMode = 'none';

  cross = new Graphics();
  cross.rect(-8, -1, 16, 2).rect(-1, -8, 2, 16).fill({ color: 0xf6f1e6, alpha: 0.85 });

  prompt = new Text({
    text: '',
    style: {
      fill: 0xf6f1e6,
      fontSize: 20,
      fontFamily: 'Georgia, Times New Roman, serif',
      stroke: { color: 0x140f0c, width: 4 },
    },
  });
  prompt.anchor.set(0.5, 1);

  stickG = new Graphics();

  useBtn = new Container();
  const useG = new Graphics();
  useG.circle(0, 0, 34).fill({ color: 0x14110e, alpha: 0.45 });
  useG.circle(0, 0, 34).stroke({ width: 2, color: 0xf3efe6, alpha: 0.85 });
  const useLabel = new Text({
    text: 'Use',
    style: { fill: 0xf3efe6, fontSize: 16, fontFamily: 'Georgia, Times New Roman, serif' },
  });
  useLabel.anchor.set(0.5);
  useBtn.addChild(useG, useLabel);
  useBtn.visible = touch;

  noteWrap = new Container();
  noteBg = new Graphics();
  noteText = new Text({
    text: NOTE,
    style: {
      fill: 0x2a241c,
      fontSize: 22,
      fontFamily: 'Georgia, Times New Roman, serif',
      align: 'center',
      lineHeight: 32,
    },
  });
  noteText.anchor.set(0.5);
  noteWrap.addChild(noteBg, noteText);
  noteWrap.visible = false;

  app.stage.addChild(stickG, cross, prompt, useBtn, noteWrap);
  layoutHud();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function fail(err) {
  const node = document.createElement('pre');
  node.id = 'boot-error';
  node.textContent = err && err.stack ? err.stack : String(err);
  document.body.appendChild(node);
}

async function boot() {
  selfCheck();
  bootThree();
  buildWorld();
  bindInput();
  await bootHud();
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
}

boot().catch(fail);
