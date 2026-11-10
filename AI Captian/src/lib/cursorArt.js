// The pointer Greeny shows while it drives this computer's mouse: the Robot
// Face cursor from the Cursor Design project (teardrop frame, black glass
// screen, glowing happy eyes and smile), tinted with the avatar's colours.
// The browser renders it to PNG frames; the desktop service shows them in a
// see-through window that follows the real pointer (sidecar/cursor_ring.py).

// Teardrop outline; the tip at (6, 6) is the click point.
const FACE = 'M6 6 L63.3 16.7 A40 40 0 1 1 16.7 63.3 Z'
// The screen is the face shrunk to 80% around the circle's centre (56, 56).
const SCREEN = 'matrix(0.8 0 0 0.8 11.2 11.2)'
// Happy eye: rounded top, curved-up bottom (like ^ ^)
const eye = (cx, cy) =>
  `M${cx - 5.5} ${cy + 4} V${cy - 0.5} A5.5 5.5 0 0 1 ${cx + 5.5} ${cy - 0.5} V${cy + 4} Q${cx} ${cy + 0.5} ${cx - 5.5} ${cy + 4} Z`
const MOUTH = 'M47 64 H67 Q66 71 57 71 Q48 71 47 64 Z'

// mode: 'open' | 'blink' | 'press' (a bigger smile and squinting eyes, for clicks)
function robotSvg(frame, glow, mode) {
  const eyes =
    mode === 'blink'
      ? 'translate(0 49) scale(1 0.12) translate(0 -49)'
      : mode === 'press'
        ? 'translate(0 49) scale(1 0.75) translate(0 -48)'
        : ''
  const mouth = mode === 'press' ? 'translate(57 67.5) scale(1.15 1.45) translate(-57 -67.5)' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.75"/>
      <stop offset="0.4" stop-color="#fff" stop-opacity="0.05"/>
      <stop offset="0.6" stop-color="#000" stop-opacity="0.25"/>
      <stop offset="0.9" stop-color="#fff" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.2"/>
    </linearGradient>
    <radialGradient id="screen" cx="0.45" cy="0.4" r="0.7">
      <stop offset="0" stop-color="#1d1e22"/><stop offset="0.7" stop-color="#050506"/><stop offset="1" stop-color="#000"/>
    </radialGradient>
    <radialGradient id="aura" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${glow}" stop-opacity="0.22"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="screenclip"><path d="${FACE}" transform="${SCREEN}"/></clipPath>
    <mask id="outside" maskUnits="userSpaceOnUse" x="-50" y="-50" width="200" height="200">
      <rect x="-50" y="-50" width="200" height="200" fill="#fff"/><path d="${FACE}" fill="#000"/>
    </mask>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g mask="url(#outside)"><path d="${FACE}" transform="translate(4 8)" fill="#000" opacity="0.6" filter="url(#soft)"/></g>
  <path d="${FACE}" fill="${frame}"/>
  <path d="${FACE}" fill="url(#metal)"/>
  <path d="${FACE}" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="${FACE}" transform="matrix(0.96 0 0 0.96 2.24 2.24)" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="1" stroke-linejoin="round"/>
  <path d="${FACE}" transform="matrix(0.84 0 0 0.84 8.96 8.96)" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="${FACE}" transform="${SCREEN}" fill="url(#screen)" stroke="#000" stroke-width="2.5" stroke-linejoin="round"/>
  <g clip-path="url(#screenclip)">
    <circle cx="57" cy="58" r="30" fill="url(#aura)"/>
    <g transform="${eyes}">
      <path d="${eye(46, 50)}" fill="${glow}" filter="url(#glow)"/>
      <path d="${eye(68, 50)}" fill="${glow}" filter="url(#glow)"/>
    </g>
    <path d="${MOUTH}" transform="${mouth}" fill="${glow}" filter="url(#glow)"/>
    <path d="M30 14 L44 14 L22 80 L8 80 Z" fill="#fff" opacity="0.06"/>
    <path d="${FACE}" transform="${SCREEN}" fill="none" stroke="#000" stroke-opacity="0.6" stroke-width="6" filter="url(#soft)"/>
  </g>
</svg>`
}

function toPng(svg) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    img.onload = () => {
      const c = Object.assign(document.createElement('canvas'), { width: 200, height: 200 })
      c.getContext('2d').drawImage(img, 0, 0, 200, 200)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png').split(',')[1])
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not draw the cursor'))
    }
    img.src = url
  })
}

// A lighter glow than the raw eye colour, like the avatar's own eyes.
function lighten(hex, amount = 0.28) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '')
  if (!m) return hex || '#ffffff'
  const mix = (v) => Math.round(parseInt(v, 16) + (255 - parseInt(v, 16)) * amount)
  return `#${[m[1], m[2], m[3]].map((v) => mix(v).toString(16).padStart(2, '0')).join('')}`
}

const cache = new Map()

// Resolves to { key, open, blink, press } (base64 PNGs, 200 x 200, tip at 12, 12).
export function cursorArt(frameColor, eyeColor) {
  const glow = lighten(eyeColor)
  const key = `robot:${frameColor}:${glow}`
  if (!cache.has(key)) {
    cache.set(
      key,
      Promise.all(['open', 'blink', 'press'].map((m) => toPng(robotSvg(frameColor, glow, m)))).then(([open, blink, press]) => ({
        key,
        open,
        blink,
        press,
      }))
    )
    cache.get(key).catch(() => cache.delete(key))
  }
  return cache.get(key)
}
