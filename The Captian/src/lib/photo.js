// Photos for the take_photo tool: grab a full camera frame, then download it
// in the browser or save it into the project's photo folder (data/photos).

// The camera frame as a JPEG data URL. The front camera is flipped so the photo
// matches the mirrored preview, like a phone's selfie camera.
export function snapshot(video, mirror = true) {
  const w = video?.videoWidth
  const h = video?.videoHeight
  if (!w || !h) return null
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = canvas.getContext('2d')
  if (mirror) {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(video, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.92)
}

// greeny-2026-11-04-153012
export function photoName(at = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `greeny-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`
}

export function downloadPhoto(url, name) {
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.jpg` })
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// Resolves to { file, folder, path }.
export async function savePhoto(url, name) {
  const res = await fetch('/api/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: url, name }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Could not save the photo (${res.status})`)
  return body
}
