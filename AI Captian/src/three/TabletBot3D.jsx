import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

// The tablet bot (three.js): a slim tablet in landscape, held on a magnetic
// disc and ball joint at the top of a slotted arm, on a weighted round base
// that rolls on four hidden casters. The screen is the face: pill eyes that
// look toward you, blink and smile with the mood, and a mouth that opens with
// the voice, drawn live into a canvas texture on the black glass.
//
// The tablet turns on its ball joint toward `lookRef` (a screen point), bobs
// a little while speaking, and nods forward with a dimmed screen in sleep. The
// stand rolls in when it first appears (the wheels really turn). Props are read
// every frame through a ref, so nothing re-renders.
//
// Ported from the ipads project (Stand.jsx / IPad.jsx / Scene.jsx), without
// react-three-fiber. 1 unit = 100 mm.

const W = 1.775 // tablet, portrait width (it is mounted landscape)
const H = 2.497
const T = 0.053
const R = 0.125 // corner radius
const B = 0.006 // edge chamfer
const BEZEL = 0.085

const DOCK = { y: 0.35, tilt: -0.2 } // the tablet's pose on the stand
const FOOT = new THREE.Vector3(0, -1.5, -0.42) // where the arm meets the base
const BALL = new THREE.Vector3(0, 0, -(T / 2 + 0.135)) // ball joint, in the tilted frame
const BASE = { y: -1.52, z: -0.2, height: 0.05 }
const WHEEL_R = 0.035
const WHEEL_Y = BASE.y - BASE.height / 2 - 0.005
const WHEELS = [
  [-0.46, -0.36],
  [0.46, -0.36],
  [-0.46, 0.36],
  [0.46, 0.36],
]
// a round dining table the stand sits on (about 120 cm across, 75 cm tall)
const TABLE = { top: WHEEL_Y - WHEEL_R, r: 6, thick: 0.32, height: 7.5 }

const FACE_W = 512 // the face is laid out in these units...
const FACE_H = 352 // (close to the screen's 1.45 : 1)
const S = 2 // ...and drawn at twice that, so the bill's text stays crisp
const rupees = (n) => `\u20b9${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const MOODS = {
  idle: { h: 1, lid: 0, cut: 0, smile: 0 },
  curious: { h: 1.08, lid: 0, cut: 0, smile: 0.2 },
  happy: { h: 0.92, lid: 0, cut: 0.62, smile: 1 },
  surprised: { h: 1.25, lid: 0, cut: 0, smile: 0 },
  sleepy: { h: 0.95, lid: 0.45, cut: 0, smile: 0 },
  asleep: { h: 0.9, lid: 0.95, cut: 0, smile: 0 },
}

// ---------- geometry ----------
function roundedRect(w, h, r) {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  s.lineTo(x + w, y + h - r)
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  s.lineTo(x + r, y + h)
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(x, y + r)
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
  return s
}

// flat rounded panel with UVs normalised to 0..1 so a texture fills it
function panel(w, h, r) {
  const g = new THREE.ShapeGeometry(roundedRect(w, h, r), 24)
  const pos = g.attributes.position
  const uv = g.attributes.uv
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h)
  return g
}

function slab(w, h, r, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(roundedRect(w - bevel * 2, h - bevel * 2, r - bevel), {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 24,
  })
  g.translate(0, 0, -(depth - bevel * 2) / 2)
  return g
}

// flat stadium-shaped bar with a long slot down the middle (the stand's arm)
function slottedBar(length, halfWidth, slotHalf) {
  const s = new THREE.Shape()
  s.absarc(0, 0, halfWidth, Math.PI, Math.PI * 2, false)
  s.lineTo(halfWidth, length)
  s.absarc(0, length, halfWidth, 0, Math.PI, false)
  s.closePath()
  const slot = new THREE.Path()
  const y0 = 0.22
  const y1 = length - 0.3
  slot.absarc(0, y0, slotHalf, Math.PI * 2, Math.PI, true)
  slot.lineTo(-slotHalf, y1)
  slot.absarc(0, y1, slotHalf, Math.PI, 0, true)
  slot.closePath()
  s.holes.push(slot)
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 20 })
  g.translate(0, 0, -0.01)
  return g
}

function canvasTexture(w, h, draw) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h })
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// `bill` (an Oasys Bay order, at any stage) is shown on the screen itself: the
// face slides left and shrinks, the panel fades in on the right. Every stage is drawn there (confirm, placed + e-receipt email,
// confirm address, sent, problem, cancelled) and its buttons can be tapped on
// the screen: onOrderAction(tool, args) runs the same tool as saying it,
// onClose() dismisses. The email box types through a hidden <input>.
export default function TabletBot3D({ mood = 'idle', speaking = false, busy = false, levelRef, lookRef, eyeColor = '#2f7bff', faceColor = '#e2e3e5', bill = null, onOrderAction, onClose, theme = 'dark' }) {
  const mountRef = useRef(null)
  const props = useRef({})
  props.current = { mood, speaking, busy, levelRef, lookRef, eyeColor, faceColor, bill, onOrderAction, onClose, theme }
  const inputRef = useRef(null) // the hidden field that takes typing for the on-screen email box

  // a new order resets the email box to what the order already has
  useEffect(() => {
    if (inputRef.current) inputRef.current.value = bill?.email || ''
  }, [bill])

  useEffect(() => {
    const mount = mountRef.current
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envMap
    scene.environmentIntensity = 0.8
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60)
    const ambient = new THREE.AmbientLight(0xffffff, 0.35)
    scene.add(ambient)
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(4, 6, 6)
    scene.add(key)
    const back = new THREE.DirectionalLight(0xffffff, 1.1)
    back.position.set(-5, 2, -6)
    scene.add(back)

    // ---------- materials ----------
    const metal = (color, roughness) => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness })
    const body = metal(props.current.faceColor, 0.42)
    const plateau = metal(props.current.faceColor, 0.3)
    const standMat = metal('#3b3e45', 0.5)
    const ringMat = metal('#18181a', 0.25)
    const port = new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.6 })
    const rubber = new THREE.MeshStandardMaterial({ color: '#0e0e0f', roughness: 0.9 })
    const glassMat = new THREE.MeshPhysicalMaterial({ color: '#020203', roughness: 0.1, specularIntensity: 0.3, envMapIntensity: 0.5 })
    // low specular keeps the black screen black under the studio light
    const screenMat = new THREE.MeshPhysicalMaterial({ color: '#000', roughness: 0.1, specularIntensity: 0.25, envMapIntensity: 0.5 })
    const lensMat = new THREE.MeshPhysicalMaterial({ color: '#05060a', roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0 })
    const irisMat = new THREE.MeshPhysicalMaterial({ color: '#0d1638', roughness: 0.1, metalness: 0.6, clearcoat: 1 })
    const flashMat = new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.35, emissive: '#fff3d6', emissiveIntensity: 0.15 })

    const disc = new THREE.CircleGeometry(1, 48)
    const barrel = new THREE.CylinderGeometry(1, 1, 1, 48).rotateX(Math.PI / 2)
    const box = new THREE.BoxGeometry(1, 1, 1)
    const sphere = new THREE.SphereGeometry(1, 32, 24)
    const mesh = (geo, mat, pos, scale, parent) => {
      const m = new THREE.Mesh(geo, mat)
      if (pos) m.position.set(...pos)
      if (scale != null) typeof scale === 'number' ? m.scale.setScalar(scale) : m.scale.set(...scale)
      parent.add(m)
      return m
    }

    // rig: everything; stand: rolls in; dock: the tilted frame on the stand;
    // pivot: the ball joint the tablet turns on
    const rig = new THREE.Group()
    scene.add(rig)
    const stand = new THREE.Group()
    rig.add(stand)
    const dock = new THREE.Group()
    dock.position.y = DOCK.y
    dock.rotation.x = DOCK.tilt
    stand.add(dock)
    const pivot = new THREE.Group()
    pivot.position.copy(BALL)
    dock.add(pivot)
    const held = new THREE.Group() // the tablet and its magnetic disc, back in the dock frame
    held.position.copy(BALL).negate()
    pivot.add(held)

    // ---------- tablet (landscape) ----------
    const tablet = new THREE.Group()
    tablet.rotation.z = Math.PI / 2
    held.add(tablet)
    const front = T / 2
    mesh(slab(W, H, R, T, B), body, null, null, tablet)
    mesh(panel(W - B * 2, H - B * 2, R - B), glassMat, [0, 0, front + 0.0006], null, tablet)
    mesh(panel(W - BEZEL * 2, H - BEZEL * 2, 0.06), screenMat, [0, 0, front + 0.0014], null, tablet)
    // front camera on the long edge (the top, in landscape)
    mesh(disc, ringMat, [W / 2 - BEZEL / 2, 0, front + 0.0014], 0.015, tablet)
    mesh(disc, irisMat, [W / 2 - BEZEL / 2, 0, front + 0.002], 0.009, tablet)
    // edges: top button, volume, port, speaker grilles
    mesh(box, body, [W / 2 - 0.15, H / 2, 0], [0.11, 0.012, 0.022], tablet)
    for (const d of [0.2, 0.31]) mesh(box, body, [W / 2, H / 2 - d, 0], [0.012, 0.085, 0.022], tablet)
    mesh(box, port, [0, -H / 2, 0], [0.09, 0.002, 0.026], tablet)
    for (const s of [-1, 1]) {
      for (const y of [-H / 2, H / 2]) {
        for (let i = -2; i <= 2; i++) mesh(box, port, [s * 0.4 + i * 0.034, y, 0], [0.022, 0.002, 0.009], tablet)
      }
    }
    // back: camera plateau with lenses and flash (no logo)
    const rear = new THREE.Group()
    rear.position.z = -front
    rear.rotation.y = Math.PI
    tablet.add(rear)
    const bump = new THREE.Group()
    bump.position.set(-W / 2 + 0.215, H / 2 - 0.215, 0)
    rear.add(bump)
    mesh(slab(0.31, 0.31, 0.085, 0.014, 0.004), plateau, [0, 0, 0.004], null, bump)
    const wide = new THREE.Group()
    wide.position.set(-0.068, 0.068, 0.011)
    bump.add(wide)
    mesh(barrel, ringMat, [0, 0, 0.004], [0.064, 0.064, 0.012], wide)
    mesh(disc, lensMat, [0, 0, 0.0105], 0.054, wide)
    mesh(disc, irisMat, [0, 0, 0.0112], 0.026, wide)
    mesh(disc, lensMat, [0, 0, 0.0118], 0.012, wide)
    const lidar = new THREE.Group()
    lidar.position.set(-0.068, -0.072, 0.011)
    bump.add(lidar)
    mesh(barrel, ringMat, [0, 0, 0.001], [0.054, 0.054, 0.004], lidar)
    mesh(disc, lensMat, [0, 0, 0.0036], 0.048, lidar)
    const flash = new THREE.Group()
    flash.position.set(0.078, -0.01, 0.011)
    bump.add(flash)
    mesh(barrel, ringMat, [0, 0, 0.001], [0.03, 0.03, 0.003], flash)
    mesh(disc, flashMat, [0, 0, 0.003], 0.024, flash)
    mesh(disc, port, [0.01, 0, 0.0116], 0.007, bump)
    mesh(disc, lensMat, [0.078, 0.082, 0.0116], 0.014, bump)

    // ---------- the face, on the screen ----------
    const faceCanvas = Object.assign(document.createElement('canvas'), { width: FACE_W * S, height: FACE_H * S })
    const fctx = faceCanvas.getContext('2d')
    const faceTex = new THREE.CanvasTexture(faceCanvas)
    faceTex.colorSpace = THREE.SRGBColorSpace
    faceTex.anisotropy = 4
    const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    // landscape screen, so the face plane is laid out in the held frame (not rotated with the tablet)
    const faceMesh = mesh(panel(H - BEZEL * 2, W - BEZEL * 2, 0.06), faceMat, [0, 0, front + 0.0022], null, held)
    faceMesh.renderOrder = 2

    // magnetic hook on the tablet's back: disc, neck, ball
    mesh(barrel, standMat, [0, 0, -(T / 2 + 0.012)], [0.42, 0.42, 0.022], held)
    mesh(barrel, standMat, [0, 0, -(T / 2 + 0.05)], [0.06, 0.06, 0.06], held)
    mesh(barrel, standMat, [0, 0, -(T / 2 + 0.085)], [0.036, 0.036, 0.05], held)
    mesh(sphere, standMat, [0, 0, 0], 0.062, pivot)

    // ---------- stand ----------
    const ballWorld = BALL.clone().applyEuler(new THREE.Euler(DOCK.tilt, 0, 0)).add(new THREE.Vector3(0, DOCK.y, 0))
    const dir = new THREE.Vector3().subVectors(ballWorld, FOOT)
    const armLen = dir.length()
    const arm = new THREE.Group()
    arm.position.copy(FOOT)
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
    stand.add(arm)
    mesh(slottedBar(armLen, 0.06, 0.02), standMat, null, null, arm)
    mesh(barrel, standMat, [0, armLen, 0], [0.075, 0.075, 0.06], arm)
    mesh(barrel, standMat, null, [0.075, 0.075, 0.07], arm)
    mesh(box, standMat, [0, FOOT.y - 0.01, FOOT.z], [0.2, 0.06, 0.12], stand)
    mesh(new THREE.CylinderGeometry(0.72, 0.74, BASE.height, 96), standMat, [0, BASE.y, BASE.z], null, stand)
    const wheels = WHEELS.map(([x, z]) => {
      const w = new THREE.Group()
      w.position.set(x, WHEEL_Y, BASE.z + z)
      stand.add(w)
      mesh(barrel, rubber, null, [WHEEL_R, WHEEL_R, 0.03], w)
      mesh(barrel, standMat, null, [WHEEL_R * 0.5, WHEEL_R * 0.5, 0.034], w)
      mesh(box, standMat, null, [WHEEL_R * 1.7, 0.007, 0.034], w)
      return w
    })

    // soft floor shadow
    const shadowTex = canvasTexture(256, 256, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
      g.addColorStop(0, 'rgba(0,0,0,0.55)')
      g.addColorStop(0.6, 'rgba(0,0,0,0.22)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    })
    const shadow = mesh(new THREE.PlaneGeometry(2.4, 1.9), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }), [0, BASE.y - 0.06, BASE.z], null, stand)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = TABLE.top + 0.004
    shadow.renderOrder = 1

    // ---------- the dining table ----------
    // a walnut-ish round top with long grain and plank seams, on a pedestal
    const woodTex = canvasTexture(1024, 1024, (ctx, w, h) => {
      ctx.fillStyle = '#6e4428'
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < 320; i++) {
        const y = Math.random() * h
        const dark = Math.random() < 0.6
        ctx.strokeStyle = dark ? `rgba(38,20,8,${0.05 + Math.random() * 0.1})` : `rgba(170,118,72,${0.04 + Math.random() * 0.08})`
        ctx.lineWidth = 0.6 + Math.random() * 2.6
        ctx.beginPath()
        for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x / 150 + i) * 5 + Math.sin(x / 41 + i * 3) * 1.6)
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(25,12,4,0.45)'
      for (let k = 1; k < 6; k++) ctx.fillRect(0, (h / 6) * k - 1, w, 2)
    })
    woodTex.anisotropy = renderer.capabilities.getMaxAnisotropy()
    const woodTop = new THREE.MeshPhysicalMaterial({ map: woodTex, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35, envMapIntensity: 0.6 })
    const woodEdge = new THREE.MeshStandardMaterial({ color: '#4a2c18', roughness: 0.55 })
    const woodDark = new THREE.MeshStandardMaterial({ color: '#2e1b0f', roughness: 0.7 })
    const table = new THREE.Group()
    rig.add(table)
    const topGeo = new THREE.CylinderGeometry(TABLE.r, TABLE.r - 0.04, TABLE.thick, 160)
    mesh(topGeo, [woodEdge, woodTop, woodDark], [0, TABLE.top - TABLE.thick / 2, 0], null, table)
    const under = TABLE.top - TABLE.thick
    mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.6, 96, 1, true), woodDark, [0, under - 0.3, 0], null, table) // apron
    mesh(new THREE.CylinderGeometry(1.6, 1.4, 0.3, 64), woodDark, [0, under - 0.15, 0], null, table)
    const floor = TABLE.top - TABLE.height
    mesh(new THREE.CylinderGeometry(0.42, 0.62, TABLE.height - 1.2, 48), woodEdge, [0, (under + floor + 0.6) / 2 - 0.15, 0], null, table)
    mesh(new THREE.CylinderGeometry(1.2, 2.4, 0.6, 64), woodEdge, [0, floor + 0.3, 0], null, table)
    // a soft shadow on the (unseen) floor under the table and chairs
    const floorShadow = mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.7, depthWrite: false }), [0, floor + 0.01, 0], null, table)
    floorShadow.rotation.x = -Math.PI / 2

    // four place settings and four chairs, on the diagonals so the front stays clear
    const ceramic = new THREE.MeshPhysicalMaterial({ color: '#f4f2ee', roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15, side: THREE.DoubleSide })
    const rimMat = new THREE.MeshStandardMaterial({ color: '#c9a86a', metalness: 1, roughness: 0.3 })
    const steel = metal('#cfd2d6', 0.22)
    const glass = new THREE.MeshPhysicalMaterial({ color: '#dfe9ee', roughness: 0.05, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
    const fabric = new THREE.MeshStandardMaterial({ color: '#8b8f7a', roughness: 0.95 })
    const plateGeo = new THREE.LatheGeometry(
      [[0, 0.012], [0.85, 0.012], [0.92, 0.035], [1.24, 0.13], [1.33, 0.15], [1.34, 0.165], [1.24, 0.15], [0.9, 0.055], [0.82, 0.03], [0, 0.03]].map(([x, y]) => new THREE.Vector2(x, y)),
      64,
    )
    const rimGeo = new THREE.TorusGeometry(1.295, 0.008, 6, 96).rotateX(Math.PI / 2)
    const glassGeo = new THREE.LatheGeometry([[0, 0], [0.3, 0], [0.32, 0.02], [0.36, 1.05], [0.345, 1.05], [0.305, 0.04], [0, 0.04]].map(([x, y]) => new THREE.Vector2(x, y)), 40)
    const CHAIR = { r: 7.4, seat: 4.6, w: 4.2, d: 4.0, back: 4.4 } // 46 cm seat, 44 cm back above it
    for (const a of [Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4]) {
      // place setting: local +z points to the table centre, the diner sits at -z
      const place = new THREE.Group()
      place.position.set(Math.sin(a) * 4.2, TABLE.top, Math.cos(a) * 4.2)
      place.rotation.y = a + Math.PI
      table.add(place)
      mesh(plateGeo, ceramic, null, null, place)
      mesh(rimGeo, rimMat, [0, 0.162, 0], null, place)
      mesh(plateGeo, ceramic, [0, 0.03, 0.05], 0.62, place) // a smaller plate on top
      mesh(box, steel, [1.62, 0.012, 0], [0.09, 0.02, 1.7], place) // fork
      for (let i = -1; i <= 1; i++) mesh(box, steel, [1.62 + i * 0.045, 0.012, 0.98], [0.02, 0.02, 0.34], place)
      mesh(box, steel, [-1.62, 0.012, 0.1], [0.1, 0.02, 2.0], place) // knife
      mesh(box, steel, [-1.85, 0.012, 0.1], [0.08, 0.02, 1.6], place) // spoon handle
      mesh(sphere, steel, [-1.85, 0.03, 1.02], [0.16, 0.03, 0.24], place)
      const g = mesh(glassGeo, glass, [-1.55, 0, 1.65], null, place)
      g.renderOrder = 3

      // chair, facing the table
      const chair = new THREE.Group()
      chair.position.set(Math.sin(a) * CHAIR.r, floor, Math.cos(a) * CHAIR.r)
      chair.rotation.y = a + Math.PI
      table.add(chair)
      const legH = CHAIR.seat - 0.3
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        mesh(box, woodEdge, [x * (CHAIR.w / 2 - 0.2), legH / 2, z * (CHAIR.d / 2 - 0.2)], [0.26, legH, 0.26], chair)
      }
      mesh(box, woodEdge, [0, CHAIR.seat - 0.15, 0], [CHAIR.w, 0.3, CHAIR.d], chair)
      mesh(slab(CHAIR.w - 0.3, CHAIR.d - 0.3, 0.3, 0.22, 0.06), fabric, [0, CHAIR.seat + 0.11, 0], null, chair).rotation.x = -Math.PI / 2
      // back: two posts rising from the rear legs, a curved top rail and slats
      const by = CHAIR.seat + CHAIR.back / 2
      const bz = -(CHAIR.d / 2 - 0.2)
      for (const x of [-1, 1]) mesh(box, woodEdge, [x * (CHAIR.w / 2 - 0.2), by, bz], [0.26, CHAIR.back, 0.26], chair)
      mesh(box, woodEdge, [0, CHAIR.seat + CHAIR.back - 0.4, bz], [CHAIR.w - 0.2, 0.7, 0.2], chair)
      for (let i = -2; i <= 2; i++) mesh(box, woodEdge, [i * 0.62, CHAIR.seat + (CHAIR.back - 0.7) / 2, bz], [0.16, CHAIR.back - 0.7, 0.14], chair)
    }

    // ---------- face drawing ----------
    const f = { h: 1, lid: 0, cut: 0, smile: 0, open: 0, blink: 0, gx: 0, gy: 0, glow: 1, side: 0 }
    let nextBlink = performance.now() + 2000
    let blinkUntil = 0
    const layer = Object.assign(document.createElement('canvas'), { width: FACE_W * S, height: FACE_H * S })
    const lctx = layer.getContext('2d')
    const pill = (ctx, x, y, w, h) => {
      ctx.beginPath()
      ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) / 2)
      ctx.fill()
    }
    // the face, shrunk and slid to the left while the bill is up (f.side 0..1)
    const faceTransform = (ctx) => {
      const sc = 1 - 0.38 * f.side
      const cx = FACE_W / 2 - (FACE_W / 2 - 122) * f.side
      ctx.setTransform(S * sc, 0, 0, S * sc, S * (cx - (FACE_W / 2) * sc), S * (FACE_H / 2 - (FACE_H / 2) * sc))
    }
    function drawEyesAndMouth(ctx, color) {
      const ew = 62
      const eh = 128 * f.h
      const cy = 146 + f.gy
      const lid = clamp(Math.max(f.lid, f.blink), 0, 0.97)
      for (const side of [-1, 1]) {
        const cx = FACE_W / 2 + side * 96 + f.gx
        lctx.setTransform(1, 0, 0, 1, 0, 0)
        lctx.clearRect(0, 0, layer.width, layer.height)
        faceTransform(lctx)
        lctx.fillStyle = color
        pill(lctx, cx, cy, ew, eh)
        lctx.globalCompositeOperation = 'destination-out'
        if (lid > 0) lctx.fillRect(cx - ew, cy - eh / 2 - 4, ew * 2, eh * lid + 4)
        if (f.cut > 0.01) {
          lctx.beginPath()
          lctx.ellipse(cx, cy + eh / 2 + eh * 0.62 * (1 - f.cut * 0.95), ew * 0.85, eh * 0.62, 0, 0, Math.PI * 2)
          lctx.fill()
        }
        lctx.globalCompositeOperation = 'source-over'
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.save()
        ctx.shadowColor = color
        ctx.shadowBlur = 26 * S
        ctx.drawImage(layer, 0, 0)
        ctx.restore()
        ctx.drawImage(layer, 0, 0)
      }
      const show = Math.max(f.smile, f.open > 0.02 ? 1 : 0)
      if (show > 0.02) {
        const mw = 54 + f.smile * 22
        const my = 262 + f.gy * 0.6
        const lift = f.smile * 16
        const depth = 10 + f.open * 46
        ctx.save()
        faceTransform(ctx)
        ctx.globalAlpha = clamp(show, 0, 1) * f.glow
        ctx.shadowColor = color
        ctx.shadowBlur = 20 * S
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(FACE_W / 2 - mw + f.gx, my - lift)
        ctx.quadraticCurveTo(FACE_W / 2 + f.gx, my - lift + 6, FACE_W / 2 + mw + f.gx, my - lift)
        ctx.quadraticCurveTo(FACE_W / 2 + f.gx, my - lift + depth * 2, FACE_W / 2 - mw + f.gx, my - lift)
        ctx.fill()
        ctx.restore()
      }
    }

    // ---------- the bill, on the right of the screen ----------
    const FONT = 'Raleway, -apple-system, Segoe UI, sans-serif'
    let shownBill = null // kept while it fades out
    let billBusy = null // the bill a button was tapped on, until a new one arrives
    let buttons = [] // { x, y, w, h, confirm } in face units, for tapping
    const fit = (ctx, text, max) => {
      if (ctx.measureText(text).width <= max) return text
      let t = text
      while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
      return `${t}…`
    }
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    // wrap text into lines that fit `max` (long words, like emails, are broken anywhere)
    const wrap = (ctx, text, max) => {
      const out = []
      let cur = ''
      for (const word of String(text).split(/\s+/)) {
        let w = word
        while (ctx.measureText(w).width > max) {
          let n = w.length
          while (n > 1 && ctx.measureText(w.slice(0, n)).width > max) n--
          if (cur) {
            out.push(cur)
            cur = ''
          }
          out.push(w.slice(0, n))
          w = w.slice(n)
        }
        const next = cur ? `${cur} ${w}` : w
        if (cur && ctx.measureText(next).width > max) {
          out.push(cur)
          cur = w
        } else cur = next
      }
      if (cur) out.push(cur)
      return out
    }
    function drawBill(ctx, order, color) {
      const x0 = 238
      const x1 = FACE_W - 22
      const w = x1 - x0
      const fade = f.side * f.glow
      const p = props.current
      const busyNow = billBusy === order
      ctx.save()
      ctx.setTransform(S, 0, 0, S, 0, 0)
      ctx.globalAlpha = fade
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.beginPath()
      ctx.roundRect(x0 - 12, 18, w + 24, FACE_H - 36, 16)
      ctx.fill()
      ctx.textBaseline = 'alphabetic'
      let y = 50
      const font = (size, weight) => (ctx.font = `${weight} ${size}px ${FONT}`)
      const line = (left, right, { size = 13, weight = 500, alpha = 0.92, col } = {}) => {
        font(size, weight)
        ctx.fillStyle = col || `rgba(255,255,255,${alpha})`
        ctx.textAlign = 'right'
        const rw = right ? ctx.measureText(right).width : 0
        if (right) ctx.fillText(right, x1, y)
        ctx.textAlign = 'left'
        ctx.fillText(fit(ctx, left, w - rw - 10), x0, y)
      }
      // a wrapped paragraph, moving y past it
      const para = (text, { size = 13, weight = 500, alpha = 0.8, gap = 18, col, maxLines = 4 } = {}) => {
        font(size, weight)
        for (const l of wrap(ctx, text, w).slice(0, maxLines)) {
          line(l, '', { size, weight, alpha, col })
          y += gap
        }
      }
      const rule = (dash) => {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth = 1
        ctx.setLineDash(dash ? [3, 3] : [])
        ctx.beginPath()
        ctx.moveTo(x0, y - 16)
        ctx.lineTo(x1, y - 16)
        ctx.stroke()
        ctx.setLineDash([])
      }
      buttons = []
      const tappable = !busyNow && f.side > 0.9
      // a row of one or two buttons along the bottom: { label, busyLabel, primary, run, disabled, act }
      // (act: false for buttons that don't start a tool call, so they don't grey the panel out)
      const actions = (defs) => {
        const by = FACE_H - 70
        const bw = (w - 10 * (defs.length - 1)) / defs.length
        defs.forEach((d, i) => {
          const x = x0 + i * (bw + 10)
          ctx.globalAlpha = fade * (busyNow || d.disabled ? 0.45 : 1)
          ctx.beginPath()
          ctx.roundRect(x, by, bw, 34, 12)
          if (d.primary) {
            ctx.fillStyle = color
            ctx.fill()
            ctx.fillStyle = '#000'
          } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.5)'
            ctx.lineWidth = 1.5
            ctx.stroke()
            ctx.fillStyle = 'rgba(255,255,255,0.95)'
          }
          font(14, 600)
          ctx.textAlign = 'center'
          ctx.fillText(busyNow && d.busyLabel ? d.busyLabel : d.label, x + bw / 2, by + 22)
          if (tappable && !d.disabled) buttons.push({ x, y: by, w: bw, h: 34, run: d.run, act: d.act !== false })
        })
        ctx.globalAlpha = fade
        return by
      }
      const hint = (text, by) => {
        font(11, 500)
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.textAlign = 'left'
        ctx.fillText(fit(ctx, text, w), x0, by - 10)
      }
      const act = (tool, args) => () => p.onOrderAction?.(tool, args)
      const close = { label: 'Dismiss', run: () => p.onClose?.(), act: false }
      const red = '#ff8a84'

      if (order.stage === 'cancelled') {
        line('Order cancelled', '', { size: 17, weight: 700, alpha: 1 })
        y += 26
        line('Nothing was billed.', '', { alpha: 0.7 })
        actions([close])
      } else if (order.stage === 'problem') {
        line('Order needs a change', '', { size: 17, weight: 700, alpha: 1 })
        y += 28
        for (const pr of (order.problems || []).slice(0, 4)) para(pr, { maxLines: 2 })
        actions([close])
      } else if (order.stage === 'placed') {
        line('✓ Order placed', '', { size: 17, weight: 700, alpha: 1 })
        y += 22
        line(`${order.bill_no || ''}  ·  Total ${rupees(order.total)}${order.table ? ` · ${order.table}` : ''}`, '', { alpha: 0.65 })
        y += 34
        line('Want a receipt? Email it, or print it.', '', { size: 14, weight: 600, alpha: 1 })
        y += 12
        // the email box: tapping it focuses a hidden <input> that takes the typing
        const input = inputRef.current
        const value = input?.value || ''
        const typed = value.trim()
        const focused = !!input && document.activeElement === input
        const bad = typed !== '' && !EMAIL_RE.test(typed)
        ctx.beginPath()
        ctx.roundRect(x0, y, w, 34, 10)
        ctx.strokeStyle = bad ? red : focused ? color : 'rgba(255,255,255,0.55)'
        ctx.lineWidth = focused ? 2 : 1.2
        ctx.stroke()
        font(13, 500)
        ctx.textAlign = 'left'
        ctx.fillStyle = value ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)'
        let txt = value || (focused ? '' : 'Tap to type your email')
        while (txt.length > 1 && ctx.measureText(txt).width > w - 22) txt = txt.slice(1) // keep the end in view while typing
        ctx.fillText(txt, x0 + 10, y + 22)
        if (focused && Math.floor(performance.now() / 530) % 2 === 0) {
          ctx.fillStyle = color
          ctx.fillRect(x0 + 11 + (value ? ctx.measureText(txt).width : 0), y + 9, 1.5, 17)
        }
        if (tappable) buttons.push({ x: x0, y, w, h: 34, run: () => input?.focus({ preventScroll: true }), act: false, text: true })
        y += 52
        if (bad) line('That doesn’t look like an email address.', '', { size: 11, col: red })
        else if (order.error) {
          para(order.error, { size: 11, col: red, gap: 13, maxLines: 3 }) // e.g. what to do when the printer is not connected
          y -= 13
        }
        // the paper receipt: one tap, or it shows that it has printed
        y += 14
        if (order.printed) {
          line('✓ Paper receipt printed', '', { size: 13, weight: 600, alpha: 0.9 })
        } else {
          ctx.globalAlpha = fade * (busyNow ? 0.45 : 1)
          ctx.beginPath()
          ctx.roundRect(x0, y, w, 34, 12)
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'
          ctx.lineWidth = 1.5
          ctx.stroke()
          font(14, 600)
          ctx.fillStyle = 'rgba(255,255,255,0.95)'
          ctx.textAlign = 'center'
          ctx.fillText(busyNow ? 'Working…' : 'Print paper receipt', x0 + w / 2, y + 22)
          ctx.globalAlpha = fade
          if (tappable) buttons.push({ x: x0, y, w, h: 34, run: act('print_receipt', { guest_asked: true }), act: true })
        }
        actions([
          { label: 'Next', primary: true, disabled: !typed || bad, run: act('set_receipt_email', { email: typed }) },
          { label: 'No thanks', run: () => p.onClose?.(), act: false },
        ])
      } else if (order.stage === 'receipt_confirm') {
        line(`Send e-receipt for ${order.bill_no || 'this order'} to:`, '', { size: 14, weight: 600, alpha: 0.85 })
        y += 30
        para(order.email || '', { size: 18, weight: 700, alpha: 1, gap: 22, maxLines: 3 })
        y += 6
        para('Is this address right? Say “yes” or tap below.', { size: 12, alpha: 0.65 })
        actions([
          { label: 'Yes, send', busyLabel: 'Sending…', primary: true, run: act('send_receipt', { confirm: true }) },
          { label: 'Change', run: act('send_receipt', { confirm: false }) },
        ])
      } else if (order.stage === 'receipt_sent') {
        line('✓ E-receipt sent', '', { size: 17, weight: 700, alpha: 1 })
        y += 26
        line(order.bill_no || '', '', { alpha: 0.65 })
        y += 24
        para(`Sent to ${order.email || ''}`, { alpha: 0.85 })
        actions([close])
      } else if (order.stage === 'payment') {
        // confirmed: waiting to hear how they will pay, then it is billed
        line(`How will you pay?${order.table ? ` · ${order.table}` : ''}`, '', { size: 17, weight: 700, alpha: 1 })
        y += 30
        const n = (order.lines || []).reduce((s, l) => s + (l.quantity || 0), 0)
        line(`${n} item${n === 1 ? '' : 's'} confirmed`, '', { alpha: 0.7 })
        y += 24
        rule(false)
        line('Total', rupees(order.total), { size: 15, weight: 700, alpha: 1 })
        const pay = (label, method) => ({ label, busyLabel: 'Placing…', run: act('confirm_order', { confirm: true, payment_method: method }) })
        const by = actions([pay('Cash', 'cash'), pay('UPI', 'upi'), pay('Card', 'card')])
        hint('Say “cash”, “UPI” or “card”, or tap one.', by)
      } else {
        // pending: waiting for the guest's yes
        line(`Confirm order${order.table ? ` · ${order.table}` : ''}`, order.payment ? `Pay: ${order.payment}` : '', { size: 17, weight: 700, alpha: 1 })
        y += 30
        const lines = order.lines || []
        const room = 5
        for (const l of lines.slice(0, lines.length > room ? room - 1 : room)) {
          line(`${l.quantity} × ${l.name}`, rupees(l.line_total))
          y += 20
        }
        if (lines.length > room) {
          line(`+ ${lines.length - room + 1} more`, '', { alpha: 0.6 })
          y += 20
        }
        if (order.tax > 0 || order.service_charge > 0) {
          y += 10
          rule(true)
          line('Subtotal', rupees(order.subtotal), { alpha: 0.65 })
          y += 18
          if (order.service_charge > 0) {
            line('Service charge', rupees(order.service_charge), { alpha: 0.65 })
            y += 18
          }
          if (order.tax > 0) {
            line(`Tax (${order.tax_rate}%)`, rupees(order.tax), { alpha: 0.65 })
            y += 18
          }
        }
        y += 12
        rule(false)
        line('Total', rupees(order.total), { size: 15, weight: 700, alpha: 1 })
        const by = actions([
          { label: 'Confirm', busyLabel: 'Placing…', primary: true, run: act('confirm_order', { confirm: true }) },
          { label: 'Cancel', run: act('confirm_order', { confirm: false }) },
        ])
        hint(order.payment ? 'Say “yes” or tap Confirm. Billed straight away.' : 'Say “yes” or tap Confirm. Payment is asked next.', by)
      }
      ctx.restore()
    }

    function drawFace(color, order) {
      const ctx = fctx
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, faceCanvas.width, faceCanvas.height)
      ctx.globalAlpha = f.glow
      drawEyesAndMouth(ctx, color)
      ctx.globalAlpha = 1
      if (order && f.side > 0.02) drawBill(ctx, order, color)
      else buttons = []
      faceTex.needsUpdate = true
    }

    // tapping a button on the screen (a click, not an orbit drag)
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const hitButton = (e) => {
      if (!buttons.length) return null
      const r = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObject(faceMesh)[0]
      if (!hit?.uv) return null
      const x = hit.uv.x * FACE_W
      const y = (1 - hit.uv.y) * FACE_H
      return buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null
    }
    let downAt = null
    const onDown = (e) => (downAt = { x: e.clientX, y: e.clientY })
    const onUp = (e) => {
      const d = downAt
      downAt = null
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return
      const b = hitButton(e)
      if (!b || !shownBill) return inputRef.current?.blur()
      if (!b.text) inputRef.current?.blur()
      if (b.act) billBusy = shownBill
      b.run()
    }
    const onMove = (e) => {
      if (e.buttons) return
      const b = hitButton(e)
      renderer.domElement.style.cursor = b ? (b.text ? 'text' : 'pointer') : ''
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointermove', onMove)

    // ---------- framing + orbit controls ----------
    // drag to turn around it, scroll / pinch to zoom, double-click resets
    const TARGET = new THREE.Vector3(0, -1.1, 0)
    const HOME_DIR = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(19)), Math.cos(THREE.MathUtils.degToRad(19))) // ~19° above the tabletop
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(TARGET)
    controls.enablePan = false
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.7
    controls.zoomSpeed = 0.8
    controls.minPolarAngle = THREE.MathUtils.degToRad(35)
    controls.maxPolarAngle = THREE.MathUtils.degToRad(92) // stay above the tabletop
    let fitDist = 0
    function resize() {
      const w = mount.clientWidth || 1
      const h = mount.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      // frame the whole table: its 12-unit top spans ~89% of the height (and never more than ~85% of the width)
      const fov = THREE.MathUtils.degToRad(camera.fov)
      const byH = 12 / 0.89 / 2 / Math.tan(fov / 2)
      const byW = 12 / 0.85 / 2 / Math.tan(fov / 2) / camera.aspect
      const d = Math.max(byH, byW)
      if (!fitDist) camera.position.copy(TARGET).addScaledVector(HOME_DIR, d)
      else camera.position.copy(TARGET).add(camera.position.clone().sub(TARGET).multiplyScalar(d / fitDist))
      fitDist = d
      controls.minDistance = d * 0.25 // scroll in right up to the tablet
      controls.maxDistance = d * 1.3
      camera.lookAt(TARGET)
      camera.updateProjectionMatrix()
      controls.update()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(mount)
    resize()
    let homing = false
    const goHome = () => (homing = true)
    renderer.domElement.addEventListener('dblclick', goHome)
    controls.addEventListener('start', () => (homing = false))
    const homePos = new THREE.Vector3()

    // ---------- animation ----------
    let raf = 0
    let last = performance.now()
    // aim: where it is heading (a critically damped spring, so turns ease in and out);
    // body: the stand swivelling on its base, a beat behind; head: the ball joint makes up the rest
    const turn = { yaw: 0, pitch: 0, aim: 0, aimVel: 0, body: 0 }
    const tmpColor = new THREE.Color()
    let rollX = reduced ? 0 : 1.4 // rolls in from the side
    const lookRay = new THREE.Raycaster()
    const lookNdc = new THREE.Vector2()
    const seatPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(TABLE.top + 3)) // about a seated diner's chest height
    const seatHit = new THREE.Vector3()
    // the direction (yaw around the stand's base, 0 = facing front) of a screen point, found by
    // casting it into the room, so pointing at a chair (or a person standing there) turns it to that chair
    function yawToward(look) {
      const rect = renderer.domElement.getBoundingClientRect()
      if (!rect.width || !rect.height) return 0
      lookNdc.set(((look.x - rect.left) / rect.width) * 2 - 1, -((look.y - rect.top) / rect.height) * 2 + 1)
      lookRay.setFromCamera(lookNdc, camera)
      let dx, dz
      if (lookRay.ray.intersectPlane(seatPlane, seatHit)) {
        dx = seatHit.x
        dz = seatHit.z - BASE.z
      } else {
        dx = lookRay.ray.direction.x // above the horizon: head that way
        dz = lookRay.ray.direction.z
      }
      if (Math.hypot(dx, dz) < 1e-3) return 0
      return clamp(Math.atan2(dx, dz), -2.4, 2.4)
    }
    const damp = THREE.MathUtils.damp

    const tick = (now) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const p = props.current
      const k = 1 - Math.exp(-dt / 0.12)
      const asleep = p.mood === 'asleep'

      // a brighter, airier room in the light theme
      const light = p.theme === 'light'
      scene.environmentIntensity = damp(scene.environmentIntensity, light ? 1.05 : 0.8, 6, dt)
      ambient.intensity = damp(ambient.intensity, light ? 0.6 : 0.35, 6, dt)

      tmpColor.set(p.faceColor)
      if (!body.color.equals(tmpColor)) {
        body.color.copy(tmpColor)
        plateau.color.copy(tmpColor).multiplyScalar(0.92)
      }

      // roll in on the casters: each wheel turns by distance / radius
      rollX = damp(rollX, 0, 2.2, dt)
      for (const w of wheels) w.rotation.z = -rollX / WHEEL_R

      // where to look: it turns toward the person, eyes first, then the head, then the whole stand
      const look = p.lookRef?.current
      let yaw = 0
      let pitch = 0
      let gy = 0
      if (look) {
        const ny = clamp((look.y / window.innerHeight) * 2 - 1, -1, 1)
        yaw = yawToward(look)
        pitch = ny * 0.12
        gy = ny * 16
      }
      if (asleep) {
        yaw = 0
        pitch = 0.32 // nods forward
      }
      if (reduced) {
        turn.aim = yaw
        turn.aimVel = 0
      } else {
        const w = 3.2 // spring stiffness: a big turn takes about a second and a half
        turn.aimVel += (w * w * (yaw - turn.aim) - 2 * w * turn.aimVel) * dt
        turn.aim += turn.aimVel * dt
      }
      // the stand swivels a beat behind; the ball joint covers what it has not turned yet
      turn.body = reduced ? turn.aim : damp(turn.body, turn.aim, 2.2, dt)
      const headYaw = clamp(turn.aim - turn.body, -0.45, 0.45)
      turn.body = turn.aim - headYaw
      turn.yaw = headYaw
      turn.pitch += (pitch - turn.pitch) * (1 - Math.exp(-dt / 0.35))
      // swivel about the base's centre, not the stand's origin
      stand.rotation.y = turn.body
      stand.position.set(rollX - BASE.z * Math.sin(turn.body), 0, BASE.z - BASE.z * Math.cos(turn.body))
      // the eyes dart ahead of the turn, then settle as it arrives
      const gx = clamp((yaw - turn.aim) * 40, -26, 26)
      const t = now / 1000
      const bob = reduced || asleep ? 0 : Math.sin(t * 0.8) * 0.006 // a slow idle drift only; no bounce while speaking
      pivot.rotation.set(turn.pitch, turn.yaw, turn.yaw * -0.05)
      pivot.position.y = BALL.y + bob

      // face
      const m = MOODS[p.mood] || MOODS.idle
      if (!reduced && now > nextBlink) {
        blinkUntil = now + 120
        nextBlink = now + 2400 + Math.random() * 3000
      }
      const lv = p.speaking ? Math.sqrt(p.levelRef?.current || 0) : 0
      f.h += (m.h - f.h) * k
      f.lid += (m.lid - f.lid) * k
      f.cut += (m.cut - f.cut) * k
      f.smile += ((p.speaking ? Math.max(m.smile, 0.4) : m.smile) - f.smile) * k
      f.open += ((p.speaking ? 0.05 + lv * 1.1 : 0) - f.open) * (1 - Math.exp(-dt / 0.05))
      f.blink += ((now < blinkUntil ? 1 : 0) - f.blink) * (1 - Math.exp(-dt / 0.04))
      f.gx += (gx - f.gx) * (1 - Math.exp(-dt / 0.08))
      f.gy += (gy - f.gy) * (1 - Math.exp(-dt / 0.08))
      // the screen dims in sleep and breathes a little while busy
      const glow = asleep ? 0.35 : p.busy ? 0.8 + 0.2 * Math.sin(now / 160) : 1
      f.glow += (glow - f.glow) * (1 - Math.exp(-dt / 0.4))
      // the bill slides in beside the face, and out again once it is gone
      if (p.bill) shownBill = p.bill
      f.side += ((p.bill ? 1 : 0) - f.side) * (1 - Math.exp(-dt / 0.18))
      if (!p.bill && f.side < 0.01) shownBill = null
      drawFace(p.eyeColor, shownBill)

      if (homing) {
        homePos.copy(TARGET).addScaledVector(HOME_DIR, fitDist)
        camera.position.lerp(homePos, 1 - Math.exp(-dt / 0.15))
        if (camera.position.distanceTo(homePos) < 0.01) homing = false
      }
      controls.update()
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('dblclick', goHome)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointermove', onMove)
      controls.dispose()
      const geos = new Set()
      const mats = new Set()
      scene.traverse((o) => {
        if (o.geometry) geos.add(o.geometry)
        if (o.material) [].concat(o.material).forEach((m) => mats.add(m))
      })
      geos.forEach((g) => g.dispose())
      mats.forEach((mat) => {
        mat.map?.dispose()
        mat.dispose()
      })
      envMap.dispose()
      pmrem.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  const submitEmail = (e) => {
    if (e.key === 'Escape') return e.currentTarget.blur()
    if (e.key !== 'Enter') return
    e.preventDefault()
    const v = e.currentTarget.value.trim()
    if (bill?.stage === 'placed' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      e.currentTarget.blur()
      onOrderAction?.('set_receipt_email', { email: v })
    }
  }
  return (
    <>
      <div ref={mountRef} className="tablet-stage" aria-hidden="true" />
      {bill?.stage === 'placed' && (
        <input
          ref={inputRef}
          className="tablet-input"
          type="email"
          inputMode="email"
          autoComplete="email"
          aria-label="Email for the e-receipt"
          defaultValue={bill.email || ''}
          onKeyDown={submitEmail}
        />
      )}
    </>
  )
}
