import { useEffect, useRef, useState } from 'react'
import Icon from './icons.jsx'
import ReflectiveCard from './ReflectiveCard.jsx'

// The webcam window as a landscape metal card (React Bits' ReflectiveCard,
// with the demo's settings: colour reflection, no shine band, soft glare).
// The live camera fills the card, sharp and in colour, and the metal plate is
// screened over it, so its sheen and the glare that follows the cursor glide
// across the picture as the card tilts. Boxes mark each face; the name and
// status sit on soft scrims at the top and bottom.
//
// The camera is drawn into a canvas each frame: a <video> inside the card's
// 3D tilt can paint black on some GPUs.
const SIZE_KEY = 'greeny.cameraCardWidth'
const COLLAPSED_KEY = 'greeny.cameraCardCollapsed'
const MIN_W = 160
const maxW = () => Math.max(MIN_W, Math.min(960, window.innerWidth - 32, ((window.innerHeight - 32) * 4) / 3))
const clampW = (w) => Math.round(Math.max(MIN_W, Math.min(maxW(), w)))

function savedWidth() {
  try {
    const w = Number(localStorage.getItem(SIZE_KEY))
    return w > 0 ? clampW(w) : null
  } catch {
    return null
  }
}

export default function CameraCard({ stream, mirror, who, faceSeen, people = [], nameOf, showBoxes, tracking, fps, tint }) {
  const canvasRef = useRef(null)
  // the card sits in the bottom-right corner, so it grows from its top-left
  // grip; null means the default CSS size. The chosen width is remembered.
  const [width, setWidth] = useState(savedWidth)
  // folded down to a round camera button in the corner; remembered too
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })
  const setCollapsed = (v) => {
    setCollapsedState(v)
    try {
      localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0')
    } catch {}
  }
  const cardRef = useRef(null)
  const onGrip = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const grip = e.currentTarget
    grip.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const startW = cardRef.current.offsetWidth
    let last = startW
    const move = (ev) => {
      // dragging up or left grows it; follow whichever axis moved further
      const dx = startX - ev.clientX
      const dy = ((startY - ev.clientY) * 4) / 3
      last = clampW(startW + (Math.abs(dx) > Math.abs(dy) ? dx : dy))
      setWidth(last)
    }
    const up = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
      grip.removeEventListener('pointercancel', up)
      try {
        localStorage.setItem(SIZE_KEY, String(last))
      } catch {}
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
    grip.addEventListener('pointercancel', up)
  }
  const resetSize = () => {
    setWidth(null)
    try {
      localStorage.removeItem(SIZE_KEY)
    } catch {}
  }
  // keep it on screen when the window shrinks
  useEffect(() => {
    if (width == null) return undefined
    const fit = () => setWidth((w) => (w == null ? w : clampW(w)))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [width == null])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !stream) return undefined
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: stream })
    video.play().catch(() => {})
    const ctx = canvas.getContext('2d')
    let raf = 0
    let lastTime = -1
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (!vw || video.currentTime === lastTime) return
      lastTime = video.currentTime
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (!w || !h) return
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      // cover the card, like object-fit: cover; mirror the front camera
      const s = Math.max(w / vw, h / vh)
      ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? w : 0, 0)
      ctx.drawImage(video, (w - vw * s) / 2, (h - vh * s) / 2, vw * s, vh * s)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      video.srcObject = null
    }
  }, [stream, mirror, collapsed])

  const pct = (n) => `${Math.max(0, Math.min(100, n * 100))}%`
  // boxes come in camera coordinates; the front camera is shown mirrored
  const box = (b) => ({
    left: pct(mirror ? 1 - b.x - b.w : b.x),
    top: pct(b.y),
    width: pct(b.w),
    height: pct(b.h),
    '--box': b.id ? '#43c59e' : '#e2ad4b',
  })
  const name = who || (faceSeen ? 'Someone new' : 'No one in view')

  const dot = tracking ? '#22c55e' : '#e2ad4b'

  if (collapsed) {
    return (
      <button
        type="button"
        className="camera-fab"
        onClick={() => setCollapsed(false)}
        title={`Show camera${who ? ` · ${who}` : ''}`}
        aria-label="Show camera"
      >
        <Icon name="video" size={22} />
        <span className="camera-fab__dot" style={{ background: dot }} />
      </button>
    )
  }

  return (
    <div className="camera-card" ref={cardRef} style={width ? { width } : undefined}>
      <div
        className="camera-card__grip"
        role="separator"
        aria-label="Resize camera (double-click to reset)"
        title="Drag to resize · double-click to reset"
        onPointerDown={onGrip}
        onDoubleClick={resetSize}
      />
      <ReflectiveCard
        stream={stream}
        mirror={mirror}
        width="100%"
        height="100%"
        radius={22}
        tint={tint}
        metalness={1}
        roughness={0.3}
        blurStrength={4.5}
        shine={0}
        glare={0.3}
        grayscale={0}
        tiltStrength={8}
      >
        <canvas ref={canvasRef} className="camera-card__view" role="img" aria-label="Camera preview" />
        {showBoxes && (
          <div className="camera-card__boxes">
            {people.map((p, i) => (
              <div key={i} className="bbox is-face" style={box(p)}>
                <span>{p.id ? nameOf(p.id) : 'unknown'}</span>
              </div>
            ))}
          </div>
        )}
        <div className="reflective-card__header camera-card__top">
          <span className="reflective-card__badge">
            <Icon name="video" size={15} />
            Camera
          </span>
          <span className="reflective-card__status">
            <span className="reflective-card__dot" style={{ background: dot }} />
            {tracking ? (fps ? `${fps} fps` : 'Live') : 'Starting'}
          </span>
          <button
            type="button"
            className="camera-card__collapse"
            onClick={() => setCollapsed(true)}
            onPointerDown={(e) => e.stopPropagation()}
            title="Collapse camera"
            aria-label="Collapse camera"
          >
            <Icon name="minimize" size={14} />
          </button>
        </div>
        <div className="camera-card__foot">
          <span className="reflective-card__name">{name}</span>
          <span className="reflective-card__role">{who ? 'Recognised' : faceSeen ? 'Not saved yet' : 'Step into view'}</span>
        </div>
      </ReflectiveCard>
    </div>
  )
}
