import { useCallback, useEffect, useRef, useState } from 'react'
import * as ort from 'onnxruntime-web/webgpu'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import { INPUT, decodeYolo, decodeYuNetAll, toYoloInput, toYuNetInput } from './lib/detection.js'
import { FACE_SIZE, averageEmbeddings, isFrontal, matchFace, normalize, similarityTransform } from './lib/faces.js'

const MAX_FACES = 4 // people recognised at once

// The version tag keeps a browser from reusing an engine file it cached earlier: a stale
// copy made the multi-threaded engine hang forever at start-up, with no error.
const tag = `?v=${ort.env.versions?.web || '1'}-2`
ort.env.wasm.wasmPaths = { mjs: mjsUrl + tag, wasm: wasmUrl + tag }
// Set (for this tab) when the multi-threaded engine failed to start; see loadModels.
function flagged(key) {
  try {
    return !!sessionStorage.getItem(key)
  } catch {
    return false
  }
}
// several threads when the page is cross-origin isolated (vite.config.js sends
// the headers); a plain page can only run one
const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
const threads = isolated && !flagged('tracker-one-thread') ? Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2))) : 1
ort.env.wasm.numThreads = threads
if (threads === 1) console.info(isolated ? '[tracker] the multi-threaded engine stalled earlier: detection runs on one CPU thread' : '[tracker] not cross-origin isolated: detection runs on one CPU thread')

// Run on the GPU through WebGPU only when the gpu setting is switched on and the
// browser offers it; otherwise on the CPU. This is decided once per page load.
function wantsGpu() {
  try {
    if (sessionStorage.getItem('greeny-no-gpu')) return false // WebGPU failed earlier in this tab
    if (JSON.parse(localStorage.getItem('ai-captain-settings') || '{}').gpu !== true) return false
  } catch {
    return false // storage unavailable: use the default (off)
  }
  return typeof navigator !== 'undefined' && !!navigator.gpu
}
const GPU = wantsGpu()
// On the CPU, inference goes in ORT's own worker so the page stays responsive.
// WebGPU can't run behind that worker, but there the GPU does the heavy lifting.
ort.env.wasm.proxy = !GPU
const backend = GPU ? 'gpu' : 'cpu'

// WebGPU sessions have to be created one at a time.
let sessionQueue = Promise.resolve()
function createSession(path) {
  const made = sessionQueue.then(async () => {
    if (!GPU) return ort.InferenceSession.create(path, { executionProviders: ['wasm'] })
    try {
      return await ort.InferenceSession.create(path, { executionProviders: ['webgpu'] })
    } catch (e) {
      // The CPU backend can't be switched to its worker once WebGPU has been
      // tried, so start over on the CPU with a fresh page.
      console.warn(`WebGPU failed for ${path}; reloading on the CPU:`, e)
      try {
        sessionStorage.setItem('greeny-no-gpu', '1')
      } catch {
        /* ignore */
      }
      location.reload()
      return new Promise(() => {})
    }
  })
  sessionQueue = made.catch(() => {})
  return made
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Sessions are created once per page load and reused across retries.
let modelsPromise
const LOAD_TIMEOUT_MS = 30_000
function loadModels() {
  if (!modelsPromise) {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Detection models did not load within ${LOAD_TIMEOUT_MS / 1000}s`)), LOAD_TIMEOUT_MS)
    })
    const sessions = Promise.all([createSession('/models/yolov8n-f32.onnx'), createSession('/models/yunet.onnx')])
    // WebGPU and the multi-threaded engine can both hang at start-up without an error, so they
    // get a deadline and a simpler mode to fall back to. The single-threaded CPU engine has
    // nothing simpler below it and gets no deadline: on a slow machine it just takes longer.
    const fallback = GPU ? 'greeny-no-gpu' : threads > 1 ? 'tracker-one-thread' : null
    let timedOut = false
    timeout.catch(() => (timedOut = true))
    if (!fallback) clearTimeout(timer)
    modelsPromise = (fallback ? Promise.race([sessions, timeout]) : sessions)
      .finally(() => clearTimeout(timer))
      .catch((e) => {
        modelsPromise = undefined
        sessionQueue = Promise.resolve() // don't let a retry wait behind a session that never finished
        if (fallback && (GPU || timedOut)) {
          // the engine can't change mode once started: start over with a fresh page
          console.warn(`Model load stalled; reloading ${GPU ? 'on the CPU' : 'on one CPU thread'}:`, e)
          try {
            sessionStorage.setItem(fallback, '1')
            location.reload()
            return new Promise(() => {})
          } catch {
            /* storage unavailable: a reload would stall the same way, so report the error instead */
          }
        }
        throw e
      })
  }
  return modelsPromise
}

// The recognition model (SFace) loads on its own so a slow download never
// delays tracking; recognition simply starts once it is ready.
let sfacePromise
function loadSface() {
  if (!sfacePromise) {
    sfacePromise = createSession('/models/sface.onnx').catch((e) => {
      sfacePromise = undefined
      throw e
    })
  }
  return sfacePromise
}

// 128-number identity vector for the face with the given landmarks: the face
// is rotated and scaled to the standard 112x112 pose, then run through SFace.
async function embedFace(session, video, kps, ctx) {
  const [a, b, tx, ty] = similarityTransform(kps)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, FACE_SIZE, FACE_SIZE)
  ctx.setTransform(a, b, -b, a, tx, ty)
  ctx.drawImage(video, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const { data } = ctx.getImageData(0, 0, FACE_SIZE, FACE_SIZE)
  const n = FACE_SIZE * FACE_SIZE
  const input = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    input[i] = data[i * 4] // RGB, 0..255
    input[n + i] = data[i * 4 + 1]
    input[2 * n + i] = data[i * 4 + 2]
  }
  const out = await session.run({ data: new ort.Tensor('float32', input, [1, 3, FACE_SIZE, FACE_SIZE]) })
  return normalize(out.fc1.data)
}

// Small mirrored square JPEG of the face, for the faces list.
function faceThumbnail(video, box) {
  const size = Math.max(box.w, box.h) * 1.6
  const c = document.createElement('canvas')
  c.width = c.height = 96
  const g = c.getContext('2d')
  g.translate(96, 0)
  g.scale(-1, 1)
  g.drawImage(video, box.x + box.w / 2 - size / 2, box.y + box.h / 2 - size / 2, size, size, 0, 0, 96, 96)
  return c.toDataURL('image/jpeg', 0.82)
}

// Draws the source rect (sx, sy, sw, sh) of the video letterboxed into the
// INPUT x INPUT canvas and returns the pixels plus the placement used.
function letterbox(ctx, video, sx, sy, sw, sh) {
  const scale = Math.min(INPUT / sw, INPUT / sh)
  const dw = sw * scale
  const dh = sh * scale
  const dx = (INPUT - dw) / 2
  const dy = (INPUT - dh) / 2
  ctx.fillStyle = '#727272'
  ctx.fillRect(0, 0, INPUT, INPUT)
  ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)
  const { data } = ctx.getImageData(0, 0, INPUT, INPUT)
  return { data, scale, dx, dy }
}

function describeCameraError(e) {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { state: 'denied', message: 'Camera access is blocked' }
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { state: 'nocamera', message: 'No camera found' }
    case 'NotReadableError':
      return { state: 'nocamera', message: 'Camera is in use by another app' }
    default:
      return { state: 'error', message: e?.message || 'Something went wrong' }
  }
}

// Finds objects (and the person) with YOLOv8n, then refines to their face with
// YuNet. Models and thresholds come from `settings` (yolo, yunet, objectConf,
// faceConf, onlyPeople) and can change while it runs.
//
// Returns:
//   target  null, or { x, y, objects, face } with normalized (0..1) video
//           coordinates; `x`,`y` is the point to look at
//   status  { state: loading | camera | tracking | denied | nocamera | error, message }
//   fps     inference rate
//   retry   restart after a failure
export function usePersonTracker(settings, faces = []) {
  const videoRef = useRef(null)
  const cfgRef = useRef(settings)
  cfgRef.current = settings
  const facesRef = useRef(faces)
  facesRef.current = faces
  const captureRef = useRef(null)
  const [identity, setIdentity] = useState(null) // { id, score } of the main face, if it is a saved one
  const [identities, setIdentities] = useState([]) // ids of every saved person in view
  const [target, setTarget] = useState(null)
  const [status, setStatus] = useState({ state: 'loading', message: 'Loading models' })
  const [fps, setFps] = useState(0)
  const [accel, setAccel] = useState(backend)
  const [attempt, setAttempt] = useState(0)
  const [camStream, setCamStream] = useState(null) // the open camera, for anything else that shows it

  const cameraOn = settings.cameraOn !== false
  const facing = settings.facing === 'environment' ? 'environment' : 'user'
  const retry = useCallback(() => setAttempt((a) => a + 1), [])

  // Takes a few samples of the face in front of the camera and resolves with
  // their average embedding and a thumbnail. Rejects if no face turns up.
  const captureFace = useCallback(
    () =>
      new Promise((resolve, reject) => {
        if (!cfgRef.current.yunet) return reject(new Error('Turn on YuNet (face lock) in settings to add a face.'))
        captureRef.current?.reject(new Error('Cancelled'))
        captureRef.current = { samples: [], resolve, reject, deadline: performance.now() + 15000, lastAt: 0, thumb: null }
      }),
    []
  )

  useEffect(() => {
    let stopped = false
    let stream

    async function run() {
      if (!cameraOn) {
        setStatus({ state: 'off', message: 'Camera off' })
        setTarget(null)
        setFps(0)
        return
      }
      setStatus({ state: 'loading', message: 'Loading models' })
      let yolo, yunet
      try {
        ;[yolo, yunet] = await loadModels()
        setAccel(backend)
      } catch (e) {
        console.error(e)
        if (!stopped) setStatus({ state: 'error', message: 'Could not load the detection models' })
        return
      }
      if (stopped) return

      try {
        setStatus({ state: 'camera', message: 'Waiting for camera permission' })
        stream = await navigator.mediaDevices.getUserMedia({
          // ideal, not exact: a device with only one camera just uses that one
          video: { width: 640, height: 480, facingMode: { ideal: facing } },
        })
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const video = videoRef.current
        video.srcObject = stream
        setCamStream(stream)
        await video.play().catch(() => {})
        if (!video.videoWidth) {
          await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }))
        }
        setStatus({ state: 'tracking', message: 'Tracking' })
      } catch (e) {
        console.warn('Camera unavailable:', e)
        if (!stopped) setStatus(describeCameraError(e))
        return
      }

      try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = INPUT
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const video = videoRef.current
        const faceCtx = Object.assign(document.createElement('canvas'), { width: FACE_SIZE, height: FACE_SIZE }).getContext('2d', {
          willReadFrequently: true,
        })
        const rec = { at: 0, id: null, seenAt: 0, tracks: [], idsKey: '' }
        let sface = null
        loadSface().then((s) => (sface = s), (e) => console.warn('Face recognition unavailable:', e))
        let frames = 0
        let frameNo = 0
        let lastObjects = []
        let lastFaceAt = 0
        let windowStart = performance.now()

        while (!stopped) {
          const cfg = cfgRef.current
          if (document.hidden || (!cfg.yolo && !cfg.yunet)) {
            setTarget(null)
            setFps(0)
            await sleep(200)
            windowStart = performance.now()
            frames = 0
            continue
          }

          const vw = video.videoWidth
          const vh = video.videoHeight

          // 1. YOLO: objects and the person, across the whole frame
          // (while a face is locked, the full-frame pass runs every third frame
          // and the last result is reused in between)
          let objects = []
          const faceLocked = performance.now() - lastFaceAt < 1000
          // the object model is the slow one on the CPU, so it runs far less often then
          if (cfg.yolo && (!faceLocked || frameNo++ % (GPU ? 3 : 12) === 0)) {
            const lb = letterbox(ctx, video, 0, 0, vw, vh)
            const out = await yolo.run({
              images: new ort.Tensor('float32', toYoloInput(lb.data), [1, 3, INPUT, INPUT]),
            })
            objects = decodeYolo(out.output0.data, cfg, lb)
            lastObjects = objects
          } else if (cfg.yolo) {
            objects = lastObjects
          }
          const person = objects.find((d) => d.cls === 0) || null

          // 2. YuNet: a face in the person's upper body (or the whole frame)
          // With several faces allowed it scans the whole frame, so everyone in
          // view is found; otherwise it looks only at the first person's upper body.
          const multi = cfg.multiFace !== false
          let faces = []
          if (cfg.yunet) {
            let sx = 0
            let sy = 0
            let sw = vw
            let sh = vh
            if (person && !multi) {
              sx = Math.max(0, person.x)
              sy = Math.max(0, person.y)
              sw = Math.max(32, Math.min(vw - sx, person.w))
              sh = Math.max(32, Math.min(vh - sy, person.h * 0.5))
            }
            const fb = letterbox(ctx, video, sx, sy, sw, sh)
            const out = await yunet.run({
              input: new ort.Tensor('float32', toYuNetInput(fb.data), [1, 3, INPUT, INPUT]),
            })
            faces = decodeYuNetAll(out, cfg.faceConf, multi ? MAX_FACES : 1).map((f) => ({
              x: sx + (f.x - fb.dx) / fb.scale,
              y: sy + (f.y - fb.dy) / fb.scale,
              w: f.w / fb.scale,
              h: f.h / fb.scale,
              score: f.score,
              kps: f.kps?.map(([kx, ky]) => [sx + (kx - fb.dx) / fb.scale, sy + (ky - fb.dy) / fb.scale]),
            }))
          }
          const face = faces[0] || null // the largest, nearest face: the one it looks at

          if (face) lastFaceAt = performance.now()

          // 3. SFace: who is it? Matches against the saved faces a couple of
          // times a second, and takes capture samples when adding a face.
          const nowMs = performance.now()
          const cap = captureRef.current
          if (cap && nowMs > cap.deadline) {
            captureRef.current = null
            cap.reject(new Error('No clear face found. Look at the camera and try again.'))
          }
          // follow each face from frame to frame by position, so every person
          // keeps their own recognition result
          for (const t of rec.tracks) t.used = false
          for (const f of faces) {
            const cx = f.x + f.w / 2
            const cy = f.y + f.h / 2
            let best = null
            let bestD = Infinity
            for (const t of rec.tracks) {
              const d = Math.hypot(t.cx - cx, t.cy - cy)
              if (!t.used && d < bestD && d < Math.max(f.w, t.w) * 1.5) {
                best = t
                bestD = d
              }
            }
            if (!best) rec.tracks.push((best = { id: null, score: 0, pending: undefined }))
            Object.assign(best, { cx, cy, w: f.w, used: true, seenAt: nowMs })
            f.track = best
          }
          rec.tracks = rec.tracks.filter((t) => nowMs - t.seenAt < 3000)

          if (faces.length && sface) {
            rec.seenAt = nowMs
            // a clear, large, front-facing face makes the best saved photo; when
            // several people are in view, a person nobody knows is the one to save
            const capFace = faces.find((f) => !f.track.id && f.kps) || face
            const capturing =
              captureRef.current &&
              capFace.kps &&
              capFace.score >= 0.7 &&
              capFace.w >= 80 &&
              isFrontal(capFace.kps) &&
              nowMs - captureRef.current.lastAt > 220
            if (capturing) {
              const emb = await embedFace(sface, video, capFace.kps, faceCtx)
              const c = captureRef.current
              if (c) {
                c.lastAt = nowMs
                c.samples.push(emb)
                c.thumb = faceThumbnail(video, capFace)
                if (c.samples.length >= 5) {
                  captureRef.current = null
                  c.resolve({ embedding: averageEmbeddings(c.samples), thumbnail: c.thumb })
                }
              }
            }
            if (cfg.recognize && nowMs - rec.at > 500 && facesRef.current.length > 0) {
              rec.at = nowMs
              for (const f of faces) {
                if (!f.kps) continue
                const m = matchFace(await embedFace(sface, video, f.kps, faceCtx), facesRef.current)
                const t = f.track
                const id = m ? m.id : null
                t.score = m ? m.score : 0
                // a track's identity only changes after the same new result twice in a row
                if (id === t.id) t.pending = undefined
                else if (t.pending === id) {
                  t.id = id
                  t.pending = undefined
                } else t.pending = id
              }
            }
          }

          // who is in view: the main face's identity, and everyone recognised
          const main = face?.track
          if (main) {
            if ((main.id || null) !== rec.id) {
              rec.id = main.id || null
              setIdentity(main.id ? { id: main.id, score: main.score } : null)
            }
          } else if (rec.id && nowMs - rec.seenAt > 3000) {
            rec.id = null
            setIdentity(null)
          }
          const idsKey = [...new Set(faces.map((f) => f.track.id).filter(Boolean))].sort().join(',')
          if (idsKey !== rec.idsKey) {
            rec.idsKey = idsKey
            setIdentities(idsKey ? idsKey.split(',') : [])
          }

          frames++
          const now = performance.now()
          if (now - windowStart >= 1000) {
            setFps(Math.round((frames * 1000) / (now - windowStart)))
            frames = 0
            windowStart = now
          }

          if (objects.length === 0 && !face) {
            setTarget(null)
            continue
          }

          const norm = (b) => b && { ...b, x: b.x / vw, y: b.y / vh, w: b.w / vw, h: b.h / vh }
          const objs = objects.map(norm)
          const p = norm(person)
          const fc = norm(face)
          const people = faces.map((f) => ({ ...norm(f), id: f.track?.id ?? null }))
          // prefer the face, then the person's upper body, then the strongest object
          let aim
          if (fc) aim = { x: fc.x + fc.w / 2, y: fc.y + fc.h / 2 }
          else if (p) aim = { x: p.x + p.w / 2, y: p.y + p.h * 0.2 }
          else aim = { x: objs[0].x + objs[0].w / 2, y: objs[0].y + objs[0].h / 2 }
          setTarget({ ...aim, objects: objs, face: fc, people })
        }
      } catch (e) {
        console.error(e)
        if (!stopped) setStatus({ state: 'error', message: 'Detection stopped unexpectedly' })
      }
    }

    run()
    return () => {
      stopped = true
      captureRef.current?.reject(new Error('Camera stopped'))
      captureRef.current = null
      stream?.getTracks().forEach((t) => t.stop())
      if (videoRef.current) videoRef.current.srcObject = null
      setCamStream(null)
      setTarget(null)
    }
  }, [attempt, cameraOn, facing])

  return { videoRef, target, status, fps, accel, retry, identity, identities, captureFace, stream: camStream }
}
