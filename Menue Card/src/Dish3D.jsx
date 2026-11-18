import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* A Chicken Chettinad, modelled entirely in code: a brass uruli on a banana
   leaf, filled with roasted-masala gravy, chicken pieces, curry leaves, dried
   red chillies, coriander and cracked pepper, with star anise on the leaf and
   steam rising off the top. */

/* ---------- Small helpers ---------- */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(s, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Smooth 3D value noise in the range -1..1. */
function noise3(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const f = (t) => t * t * (3 - 2 * t);
  const u = f(xf), v = f(yf), w = f(zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, s);
  return (
    L(
      L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
      L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v),
      w,
    ) * 2 - 1
  );
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function softBlob(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/* ---------- Textures ---------- */
function gravyTexture(rand) {
  return canvasTexture(1024, 1024, (ctx, w) => {
    const c = w / 2;
    const base = ctx.createRadialGradient(c, c, 0, c, c, c);
    base.addColorStop(0, '#8c3613');
    base.addColorStop(0.75, '#76290d');
    base.addColorStop(1, '#4e1906');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, w);

    // Thick masala texture
    const tones = ['rgba(122,42,12,0.35)', 'rgba(150,62,20,0.3)', 'rgba(88,28,8,0.35)', 'rgba(170,80,28,0.22)'];
    for (let i = 0; i < 1100; i++) {
      softBlob(ctx, rand() * w, rand() * w, 4 + rand() * 38, tones[(rand() * tones.length) | 0]);
    }
    // Pools of chilli-red oil, heavier towards the rim as in a real gravy
    for (let i = 0; i < 90; i++) {
      const a = rand() * Math.PI * 2;
      const r = c * (0.45 + rand() * 0.5);
      softBlob(ctx, c + Math.cos(a) * r, c + Math.sin(a) * r, 8 + rand() * 30, 'rgba(206,92,22,0.42)');
    }
    for (let i = 0; i < 40; i++) {
      softBlob(ctx, rand() * w, rand() * w, 5 + rand() * 16, 'rgba(232,130,40,0.35)');
    }
    // Oil ring where the gravy meets the brass
    ctx.lineWidth = 26;
    ctx.strokeStyle = 'rgba(190,70,18,0.55)';
    ctx.beginPath();
    ctx.arc(c, c, c * 0.95, 0, Math.PI * 2);
    ctx.stroke();
    // Ground spice, fennel and chilli flakes
    for (let i = 0; i < 3200; i++) {
      const s = 0.8 + rand() * 2.2;
      ctx.fillStyle = rand() < 0.72 ? `rgba(38,14,4,${0.35 + rand() * 0.4})` : `rgba(178,34,14,${0.5 + rand() * 0.4})`;
      ctx.fillRect(rand() * w, rand() * w, s, s * (0.6 + rand()));
    }
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(140,120,50,${0.4 + rand() * 0.3})`; // fennel seeds
      ctx.save();
      ctx.translate(rand() * w, rand() * w);
      ctx.rotate(rand() * Math.PI);
      ctx.fillRect(-3, -1, 6, 2);
      ctx.restore();
    }
  });
}

function leafTexture() {
  return canvasTexture(1024, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2b6a1d');
    g.addColorStop(0.5, '#3f8a2a');
    g.addColorStop(1, '#2a641b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Parallel veins running out from the midrib
    for (let x = -h; x < w + h; x += 9) {
      ctx.strokeStyle = (x / 9) % 3 === 0 ? 'rgba(18,58,10,0.4)' : 'rgba(150,200,100,0.12)';
      ctx.lineWidth = (x / 9) % 3 === 0 ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(x, h / 2);
      ctx.lineTo(x + h * 0.35, 0);
      ctx.moveTo(x, h / 2);
      ctx.lineTo(x + h * 0.35, h);
      ctx.stroke();
    }
    // Midrib
    const m = ctx.createLinearGradient(0, h / 2 - 9, 0, h / 2 + 9);
    m.addColorStop(0, 'rgba(160,200,110,0)');
    m.addColorStop(0.5, 'rgba(190,220,140,0.9)');
    m.addColorStop(1, 'rgba(160,200,110,0)');
    ctx.fillStyle = m;
    ctx.fillRect(0, h / 2 - 9, w, 18);
  });
}

function steamTexture() {
  return canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

/* ---------- Models ---------- */
const GRAVY_Y = 0.62;

function makeUruli() {
  const pts = [
    [0, 0], [0.8, 0], [0.95, 0.03], [1.3, 0.2], [1.6, 0.48], [1.78, 0.75], [1.86, 0.86],
    [1.95, 0.88], [1.98, 0.92], [1.91, 0.96], [1.82, 0.92],
    [1.72, 0.8], [1.55, 0.55], [1.25, 0.3], [0.9, 0.13], [0, 0.1],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const brass = new THREE.MeshStandardMaterial({ color: '#d6a24a', metalness: 1, roughness: 0.26, side: THREE.DoubleSide });
  const group = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 128), brass);
  bowl.castShadow = true;
  bowl.receiveShadow = true;
  group.add(bowl);
  // Ring handles on either side
  for (const side of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 16, 48), brass);
    ring.position.set(side * 2.1, 0.82, 0);
    ring.castShadow = true;
    group.add(ring);
  }
  return group;
}

function makeBananaLeaf() {
  const geo = new THREE.PlaneGeometry(7.2, 4, 80, 40);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const curl = 0.16 * Math.pow(Math.abs(z) / 2, 3) + 0.1 * Math.pow(Math.abs(x) / 3.6, 4);
    pos.setY(i, curl + 0.025 * Math.sin(x * 2.3 + z) + 0.015 * noise3(x * 1.5, 0, z * 1.5, 5));
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshPhysicalMaterial({ map: leafTexture(), color: '#8fb878', roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.5, envMapIntensity: 0.4, side: THREE.DoubleSide }),
  );
  mesh.position.y = -0.01;
  mesh.rotation.y = -0.18;
  mesh.receiveShadow = true;
  return mesh;
}

function makeGravy(rand) {
  const geo = new THREE.CircleGeometry(1.64, 128);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshPhysicalMaterial({ map: gravyTexture(rand), color: '#c9886a', roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.25, envMapIntensity: 0.25 }),
  );
  mesh.position.y = GRAVY_Y;
  mesh.receiveShadow = true;
  return mesh;
}

function makeChickenPiece(seed, withBone) {
  let geo = new THREE.IcosahedronGeometry(0.34, 5);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const dark = new THREE.Color('#3a1204'), mid = new THREE.Color('#6a240b'), light = new THREE.Color('#9a4418');
  const v = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const big = noise3(n.x * 2.2, n.y * 2.2, n.z * 2.2, seed);
    const small = noise3(n.x * 7, n.y * 7, n.z * 7, seed + 9);
    const tiny = noise3(n.x * 22, n.y * 22, n.z * 22, seed + 17);
    v.multiplyScalar(1 + big * 0.2 + small * 0.07 + tiny * 0.015);
    pos.setXYZ(i, v.x, v.y, v.z);
    // Crevices hold dark masala; raised parts catch the roast
    const t = THREE.MathUtils.clamp(0.5 + big * 0.6 + small * 0.5, 0, 1);
    col.copy(dark).lerp(mid, Math.min(1, t * 1.6));
    if (t > 0.62) col.lerp(light, (t - 0.62) * 1.6);
    if (tiny > 0.55) col.lerp(dark, 0.6); // spice specks
    colors.set([col.r, col.g, col.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const meat = new THREE.Mesh(
    geo,
    new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.6, clearcoat: 0.45, clearcoatRoughness: 0.35, envMapIntensity: 0.5 }),
  );
  meat.castShadow = true;
  meat.receiveShadow = true;
  meat.scale.set(1.3, 0.72, 1);
  const group = new THREE.Group();
  group.add(meat);
  if (withBone) {
    const boneMat = new THREE.MeshStandardMaterial({ color: '#e6d6b8', roughness: 0.6 });
    const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.42, 16), boneMat);
    bone.rotation.z = Math.PI / 2 - 0.35;
    bone.position.set(0.52, 0.12, 0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), boneMat);
    knob.scale.set(1, 0.8, 1.2);
    knob.position.set(0.72, 0.2, 0);
    bone.castShadow = knob.castShadow = true;
    group.add(bone, knob);
  }
  return group;
}

function makeChilli(seed) {
  const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.05, 0.01), new THREE.Vector2(0.068, 0.04)];
  for (let t = 0.07; t <= 1.0001; t += 0.04) pts.push(new THREE.Vector2(0.07 * Math.pow(1 - t, 0.65) + 0.003, t));
  const geo = new THREE.LatheGeometry(pts, 24);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z) || 1;
    const wr = 1 + 0.22 * noise3(x * 30, y * 9, z * 30, seed); // dried, wrinkled skin
    x *= wr;
    z *= wr;
    pos.setXYZ(i, x + 0.26 * y * y, y * 0.8, z);
    void r;
  }
  geo.computeVertexNormals();
  const pod = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: '#8c120c', roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.25 }));
  pod.castShadow = true;
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.02, 0.12, 8),
    new THREE.MeshStandardMaterial({ color: '#6f6a2a', roughness: 0.8 }),
  );
  stem.position.y = -0.05;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), stem.material);
  cap.rotation.x = Math.PI;
  cap.position.y = 0.012;
  const group = new THREE.Group();
  group.add(pod, stem, cap);
  return group;
}

function makeCurryLeafGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.1, 0.13, 0, 0.34);
  s.quadraticCurveTo(-0.1, 0.13, 0, 0);
  const geo = new THREE.ShapeGeometry(s, 14);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, 0.5 * Math.abs(x) + 0.35 * (y - 0.17) * (y - 0.17));
  }
  geo.computeVertexNormals();
  return geo;
}

function makeStarAnise() {
  const mat = new THREE.MeshStandardMaterial({ color: '#5b2c14', roughness: 0.75 });
  const group = new THREE.Group();
  const petalGeo = new THREE.SphereGeometry(0.06, 14, 10);
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Mesh(petalGeo, mat);
    const a = (i / 8) * Math.PI * 2;
    p.scale.set(2.3, 0.75, 1);
    p.position.set(Math.cos(a) * 0.12, 0.03, Math.sin(a) * 0.12);
    p.rotation.y = -a;
    p.castShadow = true;
    group.add(p);
  }
  const seedMat = new THREE.MeshStandardMaterial({ color: '#b07a3a', roughness: 0.5 });
  const centre = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), mat);
  centre.position.y = 0.05;
  group.add(centre);
  for (let i = 0; i < 8; i += 2) {
    const sd = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), seedMat);
    const a = (i / 8) * Math.PI * 2;
    sd.position.set(Math.cos(a) * 0.12, 0.075, Math.sin(a) * 0.12);
    group.add(sd);
  }
  return group;
}

/* ---------- Scene ---------- */
function buildScene(rand) {
  const scene = new THREE.Scene();
  scene.add(makeBananaLeaf());
  scene.add(makeUruli());
  scene.add(makeGravy(rand));

  // Chicken pieces, half sunk in the gravy
  const pieces = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const centre = i === n - 1;
    const a = (i / (n - 1)) * Math.PI * 2 + rand() * 0.4;
    const r = centre ? 0.05 : 0.78 + rand() * 0.28;
    const piece = makeChickenPiece(11 + i * 7, false);
    const s = centre ? 1.05 : 0.85 + rand() * 0.25;
    piece.scale.setScalar(s);
    piece.position.set(Math.cos(a) * r, GRAVY_Y + 0.06 + rand() * 0.05, Math.sin(a) * r);
    piece.rotation.set((rand() - 0.5) * 0.35, rand() * Math.PI * 2, (rand() - 0.5) * 0.35);
    scene.add(piece);
    pieces.push({ x: piece.position.x, z: piece.position.z, top: piece.position.y + 0.22 * s });
  }

  // Curry leaves
  const leafGeo = makeCurryLeafGeometry();
  const leafMat = new THREE.MeshPhysicalMaterial({ color: '#1e4a17', roughness: 0.32, clearcoat: 0.6, side: THREE.DoubleSide });
  for (let i = 0; i < 13; i++) {
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    const onPiece = i < 6;
    const p = pieces[i % pieces.length];
    const a = rand() * Math.PI * 2;
    const r = onPiece ? 0.06 + rand() * 0.1 : 0.4 + rand() * 1.05;
    leaf.position.set(
      onPiece ? p.x + Math.cos(a) * r : Math.cos(a) * r,
      onPiece ? p.top + 0.01 : GRAVY_Y + 0.012,
      onPiece ? p.z + Math.sin(a) * r : Math.sin(a) * r,
    );
    leaf.rotation.set(-Math.PI / 2 + (rand() - 0.5) * 0.3, 0, rand() * Math.PI * 2);
    leaf.scale.setScalar(0.85 + rand() * 0.4);
    leaf.castShadow = true;
    scene.add(leaf);
  }

  // Dried red chillies: three in the gravy, two on the leaf
  const chilliSpots = [
    [0.55, GRAVY_Y + 0.04, -0.35, 0.3],
    [-0.75, GRAVY_Y + 0.04, 0.35, 2.4],
    [0.2, GRAVY_Y + 0.05, 0.95, 4.1],
    [2.55, 0.06, 1.1, 0.9],
    [-2.5, 0.06, -1.05, 3.6],
  ];
  chilliSpots.forEach(([x, y, z, ry], i) => {
    const c = makeChilli(40 + i);
    c.rotation.set(0, ry, Math.PI / 2 - 0.08);
    c.position.set(x, y, z);
    scene.add(c);
  });

  // Star anise on the leaf
  [[2.35, 0.05, -0.95, 0.4], [-2.45, 0.05, 1.0, 1.2], [2.9, 0.07, 0.05, 2.0]].forEach(([x, y, z, ry]) => {
    const s = makeStarAnise();
    s.position.set(x, y, z);
    s.rotation.y = ry;
    scene.add(s);
  });

  // Chopped coriander
  const cGeo = new THREE.CircleGeometry(0.05, 9);
  const cp = cGeo.attributes.position;
  for (let i = 1; i < cp.count; i++) {
    const k = 0.75 + 0.35 * Math.abs(Math.sin(i * 1.7));
    cp.setXY(i, cp.getX(i) * k, cp.getY(i) * k);
  }
  const coriander = new THREE.InstancedMesh(
    cGeo,
    new THREE.MeshStandardMaterial({ color: '#4d8f29', roughness: 0.45, side: THREE.DoubleSide }),
    46,
  );
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p3 = new THREE.Vector3();
  for (let i = 0; i < 46; i++) {
    const onPiece = i % 2 === 0;
    const p = pieces[(rand() * pieces.length) | 0];
    const a = rand() * Math.PI * 2;
    const r = onPiece ? rand() * 0.18 : rand() * 1.5;
    p3.set(onPiece ? p.x + Math.cos(a) * r : Math.cos(a) * r, onPiece ? p.top + 0.015 : GRAVY_Y + 0.008, onPiece ? p.z + Math.sin(a) * r : Math.sin(a) * r);
    q.setFromEuler(e.set(-Math.PI / 2 + (rand() - 0.5) * 0.6, 0, rand() * Math.PI));
    sc.setScalar(0.7 + rand() * 0.7);
    coriander.setMatrixAt(i, m.compose(p3, q, sc));
  }
  scene.add(coriander);

  // Cracked black pepper
  const pepper = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.014, 0),
    new THREE.MeshStandardMaterial({ color: '#1c120c', roughness: 0.7 }),
    260,
  );
  for (let i = 0; i < 260; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 1.55;
    p3.set(Math.cos(a) * r, GRAVY_Y + 0.006, Math.sin(a) * r);
    q.setFromEuler(e.set(rand() * 3, rand() * 3, rand() * 3));
    sc.setScalar(0.6 + rand() * 0.9);
    pepper.setMatrixAt(i, m.compose(p3, q, sc));
  }
  scene.add(pepper);

  // Steam
  const steamMat = new THREE.SpriteMaterial({ map: steamTexture(), transparent: true, depthWrite: false, opacity: 0 });
  const steam = [];
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(steamMat.clone());
    s.userData = { phase: i / 16, x0: (rand() - 0.5) * 1.8, z0: (rand() - 0.5) * 1.8, sway: rand() * 6 };
    scene.add(s);
    steam.push(s);
  }

  // Lighting: warm key from above, cool fill, and a rim to lift the brass
  const key = new THREE.DirectionalLight('#ffd7a3', 2.6);
  key.position.set(3.5, 7, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  const fill = new THREE.DirectionalLight('#bcd2ff', 0.5);
  fill.position.set(-5, 3, -2);
  const rim = new THREE.DirectionalLight('#ffe9c4', 1.1);
  rim.position.set(-2, 4, -6);
  scene.add(key, fill, rim, new THREE.HemisphereLight('#fff1dc', '#2a1408', 0.35));

  return { scene, steam };
}

/* ---------- Component ---------- */
export default function Dish3D({ active = true }) {
  const mount = useRef(null);
  const activeRef = useRef(active);
  const controlsRef = useRef(null);

  useEffect(() => {
    activeRef.current = active;
    if (controlsRef.current) controlsRef.current.enabled = active;
  }, [active]);

  useEffect(() => {
    const el = mount.current;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const { scene, steam } = buildScene(mulberry32(20261106));
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 4.6, 6.3);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.45, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 4.2;
    controls.maxDistance = 11;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = 1.32;
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 1.1;
    controls.enabled = activeRef.current;
    controls.update();
    controlsRef.current = controls;

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Pull back on tall, narrow views so the whole bowl stays in frame
      camera.fov = w / h < 0.9 ? 34 / Math.max(0.62, w / h) : 34;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();
      for (const s of steam) {
        const { phase, x0, z0, sway } = s.userData;
        const k = reduceMotion ? phase : (t * 0.09 + phase) % 1;
        s.position.set(x0 + Math.sin(k * 3 + sway) * 0.3, GRAVY_Y + 0.25 + k * 2.6, z0 + Math.cos(k * 2 + sway) * 0.2);
        s.scale.setScalar(0.7 + k * 1.9);
        s.material.opacity = Math.sin(Math.PI * k) * 0.13;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((mat) => {
          mat.map?.dispose();
          mat.dispose();
        });
      });
      envRT.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      controlsRef.current = null;
    };
  }, []);

  return <div className="dish-canvas" ref={mount} />;
}
