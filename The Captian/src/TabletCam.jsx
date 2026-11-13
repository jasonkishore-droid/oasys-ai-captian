import { useEffect, useRef, useState } from 'react'
import Icon from './icons.jsx'

const MIN_W = 140
const KEY = 'tabletCam'

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}
function save(v) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* storage blocked */
  }
}

// A small live webcam window in the bottom right corner of the tablet-only view.
// It shows the same stream the tracker reads, mirrored for the front camera.
// Drag the top-left grip to resize it; the button collapses it to a round
// camera button. The size is remembered in this browser; it always opens collapsed.
export default function TabletCam({ stream, mirror, who }) {
  const videoRef = useRef(null)
  // the size is remembered, but the window always starts collapsed
  const [state, setState] = useState(() => ({ width: 260, ...load(), collapsed: true }))
  const { width, collapsed } = state
  const update = (patch) =>
    setState((s) => {
      const next = { ...s, ...patch }
      save(next)
      return next
    })

  useEffect(() => {
    const v = videoRef.current
    if (!v || !stream || collapsed) return undefined
    v.srcObject = stream
    v.play().catch(() => {})
    return () => {
      v.srcObject = null
    }
  }, [stream, collapsed])

  // the window is pinned to the bottom right, so dragging the top-left grip
  // up and left makes it bigger
  const onGrip = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const max = () => Math.max(MIN_W, window.innerWidth - 32)
    const move = (ev) => setState((s) => ({ ...s, width: Math.round(Math.min(max(), Math.max(MIN_W, startW + startX - ev.clientX))) }))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setState((s) => (save(s), s))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!stream) return null
  if (collapsed)
    return (
      <button className="tablet-cam-fab" onClick={() => update({ collapsed: false })} aria-label="Show camera">
        <Icon name="video" size={20} />
      </button>
    )
  return (
    <figure className="tablet-cam" style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
      <video ref={videoRef} muted playsInline aria-label="Webcam" style={{ transform: mirror ? 'scaleX(-1)' : undefined }} />
      {who && <figcaption>{who}</figcaption>}
      <div className="tablet-cam-grip" onPointerDown={onGrip} role="separator" aria-label="Resize camera" title="Drag to resize" />
      <button className="tablet-cam-close" onClick={() => update({ collapsed: true })} aria-label="Collapse camera" title="Collapse">
        <Icon name="minimize" size={14} />
      </button>
    </figure>
  )
}
